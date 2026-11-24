'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Map as GoogleMap, AdvancedMarker, Polyline, useMap } from '@vis.gl/react-google-maps'
import { Phone, Car, History, ExternalLink, MapPinOff, X, LocateFixed, WifiOff } from 'lucide-react'
import { safetyApi, type SosDetail } from '@/lib/safety-api'
import { extractErrorMessage } from '@/lib/http-errors'
import { getAdminSocket } from '@/lib/socket'
import { ACTIVE_STATUSES, LIVE_POINTS_MAX, LIVE_REFRESH_MS, absoluteTime, hasLocation, liveEventFor, mergeTrail, signalState, timeline, waitingClock, type LivePoint } from '@/lib/sos-model'

const FALLBACK_CENTER = { lat: 20.2961, lng: 85.8245 }
const TONE = { danger: 'bg-danger', info: 'bg-primary', success: 'bg-success' } as const
const SIGNAL_STYLE = {
  live: { dot: 'bg-success', text: 'text-success', bar: 'bg-success/10 border-success/30' },
  delayed: { dot: 'bg-warning', text: 'text-warning', bar: 'bg-warning/10 border-warning/30' },
  lost: { dot: 'bg-danger', text: 'text-danger', bar: 'bg-danger/10 border-danger/30' },
  none: { dot: 'bg-text-muted', text: 'text-text-muted', bar: 'bg-surface-2 border-border' },
} as const

// Keeps the map on the car as new positions arrive, until the admin drags the map themselves ("Follow car" turns it back on).
function FollowCar({ point, follow, onUserMove }: { point: { lat: number; lng: number } | null; follow: boolean; onUserMove: () => void }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const l = map.addListener('dragstart', onUserMove)
    return () => l.remove()
  }, [map, onUserMove])
  useEffect(() => {
    if (map && follow && point) map.panTo(point)
  }, [map, follow, point?.lat, point?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function Person({ role, name, phone, pressed }: { role: string; name: string | null; phone: string | null; pressed: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{role}{pressed ? ' · pressed SOS' : ''}</p>
        <p className="font-semibold text-text-primary truncate">{name ?? 'Unknown'}</p>
      </div>
      {phone && (
        <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border rounded-xl hover:bg-surface-2 text-primary whitespace-nowrap">
          <Phone size={12} /> {phone}
        </a>
      )}
    </div>
  )
}

interface Props {
  id: string
  busy: boolean
  onClose: () => void
  onAcknowledge: (id: string) => void
  onResolve: (id: string, kind: 'resolved' | 'false_alarm') => void
}

// The live view of one alert, beside the queue: where the car is now and how fresh that is, who is in it, what has happened, and the
// actions, so the person handling it never has to close anything to act. Refreshes every few seconds while the alert is open.
export default function SosLivePanel({ id, busy, onClose, onAcknowledge, onResolve }: Props) {
  const [detail, setDetail] = useState<SosDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [follow, setFollow] = useState(true)
  const [live, setLive] = useState<LivePoint[]>([])
  const lastLiveAt = useRef(0)
  const rideIdRef = useRef<string | null>(null)
  const [, setTick] = useState(0)
  const latest = useRef(0)
  const openNow = useRef(true)

  const read = useCallback(async () => {
    const mine = ++latest.current
    try {
      const d = await safetyApi.getSosDetail(id)
      if (mine !== latest.current) return
      setDetail(d)
      setError(null)
      setRefreshFailed(false)
      openNow.current = ACTIVE_STATUSES.has(d.status)
    } catch (e) {
      if (mine !== latest.current) return
      // Keep what is on screen; say that it may be old.
      setRefreshFailed(true)
      setError(prev => prev ?? extractErrorMessage(e, 'Could not load this alert.'))
    }
  }, [id])

  useEffect(() => {
    setDetail(null)
    setError(null)
    setFollow(true)
    setLive([])
    lastLiveAt.current = 0
    rideIdRef.current = null
    openNow.current = true
    void read()
    // While live positions are arriving over the socket the detail is only re-read now and then (status, timeline, who acknowledged);
    // when the socket is quiet it is read every few seconds, so the position still moves.
    let skipped = 0
    const poll = setInterval(() => {
      if (!openNow.current || document.hidden) return
      if (Date.now() - lastLiveAt.current < 10_000 && ++skipped < 6) return
      skipped = 0
      void read()
    }, LIVE_REFRESH_MS)
    const clock = setInterval(() => setTick(t => t + 1), 1_000)
    return () => { clearInterval(poll); clearInterval(clock); latest.current++ }
  }, [id, read])

  // Real time: once the alert's ride is known, join that ride's room (admins may) and draw each position as it is sent. Only the ride
  // being watched is joined; leaving on switch/close/unmount means nothing is received for any other ride.
  const rideId = detail?.ride_id ?? null
  const isOpen = !!detail && ACTIVE_STATUSES.has(detail.status)
  useEffect(() => {
    if (!rideId || !isOpen) return
    rideIdRef.current = rideId
    const socket = getAdminSocket()
    const join = () => socket.emit('join:ride', rideId)
    const onLocation = (e: { rideId?: unknown; lat?: unknown; lng?: unknown; speed_kmph?: unknown }) => {
      const p = liveEventFor(rideIdRef.current, e)
      if (!p) return
      lastLiveAt.current = p.at
      setLive(prev => [...prev, p].slice(-LIVE_POINTS_MAX))
    }
    join()
    socket.on('connect', join) // a reconnect starts with no rooms: join again
    socket.on('driver:location', onLocation)
    return () => {
      rideIdRef.current = null
      socket.off('connect', join)
      socket.off('driver:location', onLocation)
      socket.emit('leave:ride', rideId)
    }
  }, [rideId, isOpen])

  const sos = detail
  const trail = mergeTrail(sos?.trail ?? [], live)
  const last = trail[trail.length - 1]
  const point = sos && hasLocation(sos) ? { lat: parseFloat(sos.location_lat!), lng: parseFloat(sos.location_lng!) } : null
  const car = last ? { lat: last.lat, lng: last.lng } : null
  const open = !!sos && ACTIVE_STATUSES.has(sos.status)
  const signal = signalState(last?.recorded_at)
  const style = SIGNAL_STYLE[signal.tone]
  const driverPressed = !!sos?.triggered_by_driver
  const onUserMove = useCallback(() => setFollow(false), [])

  return (
    <aside aria-label={`Live view of SOS alert ${id}`} className="bg-surface rounded-2xl border border-border shadow-card flex flex-col overflow-hidden xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
        <div className="min-w-0">
          <p className="text-xs text-text-muted">SOS alert #{id}{sos ? ` · ${sos.status.replace(/_/g, ' ')}` : ''}</p>
          <p className="font-bold text-text-primary truncate">{sos ? (driverPressed ? sos.driver_name : sos.rider_name) ?? 'Unknown' : 'Loading…'}</p>
        </div>
        <button onClick={onClose} aria-label="Close live view" className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted"><X size={18} /></button>
      </div>

      <div className="overflow-y-auto">
        {refreshFailed && sos && (
          <p role="alert" className="flex items-center gap-2 px-5 py-2 text-xs text-warning bg-warning/10"><WifiOff size={13} /> Can&apos;t refresh. What you see may be out of date.</p>
        )}
        {error && !sos && <p role="alert" className="p-5 text-sm text-danger">{error}</p>}
        {!error && !sos && <div className="p-5 space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>}

        {sos && (
          <div className="p-5 space-y-5">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${style.bar} ${style.text}`} data-testid="signal">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot} ${signal.tone === 'live' && open ? 'animate-pulse' : ''}`} />
              <span className="min-w-0">{open ? signal.label : `Closed · ${signal.label.replace(/^(Live|Delayed|No signal) · /, '')}`}</span>
              {open && sos.status === 'triggered' && <span className="ml-auto font-mono tabular-nums text-danger whitespace-nowrap">waiting {waitingClock(sos.created_at)}</span>}
            </div>

            <div className="relative rounded-xl overflow-hidden border border-border" style={{ height: 300 }}>
              {point || car ? (
                <>
                  <GoogleMap defaultCenter={car ?? point ?? FALLBACK_CENTER} defaultZoom={15} mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID} gestureHandling="greedy" disableDefaultUI style={{ width: '100%', height: '100%' }}>
                    <FollowCar point={car ?? point} follow={follow} onUserMove={onUserMove} />
                    {trail.length >= 2 && <Polyline path={trail.map(t => ({ lat: t.lat, lng: t.lng }))} strokeColor="#0E8FA3" strokeWeight={4} strokeOpacity={0.9} />}
                    {point && <AdvancedMarker position={point}><span title="Where SOS was pressed" className="flex items-center justify-center w-6 h-6 rounded-md rotate-45 bg-danger border-2 border-white shadow animate-pulse"><span className="-rotate-45 text-[11px] font-black leading-none text-white">!</span></span></AdvancedMarker>}
                    {car && <AdvancedMarker position={car}><span title="Car" className={`block w-4 h-4 rounded-full border-2 border-white shadow ${style.dot}`} /></AdvancedMarker>}
                  </GoogleMap>
                  {!follow && car && (
                    <button onClick={() => setFollow(true)} className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-surface border border-border shadow hover:bg-surface-2">
                      <LocateFixed size={13} /> Follow car
                    </button>
                  )}
                  <p className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-surface/90 text-[11px] text-text-secondary shadow">
                    <span className="inline-block w-2 h-2 rotate-45 bg-danger mr-1" />SOS pressed here
                    <span className={`inline-block w-2 h-2 rounded-full ml-3 mr-1 ${style.dot}`} />Car
                  </p>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center px-6 text-sm text-text-muted">
                  <MapPinOff size={24} className="mb-2 text-warning" />
                  No position was shared and the car has sent no trail yet. Call the rider and the driver.
                </div>
              )}
            </div>
            {last && <p className="text-xs text-text-muted -mt-3">{last.speed_kmph != null ? `${Math.round(last.speed_kmph)} km/h · ` : ''}car position {absoluteTime(last.recorded_at)}</p>}

            {open && (
              <div className="flex flex-wrap gap-2">
                {sos.status === 'triggered' && (
                  <button disabled={busy} onClick={() => onAcknowledge(sos.id)} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50">
                    {busy ? 'Acknowledging…' : 'Acknowledge'}
                  </button>
                )}
                <button disabled={busy} onClick={() => onResolve(sos.id, 'resolved')} className="px-4 py-2 text-sm font-semibold bg-success text-white rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50">Mark Resolved</button>
                <button disabled={busy} onClick={() => onResolve(sos.id, 'false_alarm')} className="px-4 py-2 text-sm font-semibold border border-border rounded-xl hover:bg-surface-2 transition-colors text-text-secondary disabled:opacity-50">False Alarm</button>
              </div>
            )}

            <section>
              <h3 className="text-sm font-bold text-text-primary mb-1">People</h3>
              <div className="divide-y divide-border">
                <Person role="Rider" name={sos.rider_name} phone={sos.rider_phone} pressed={!driverPressed} />
                <Person role="Driver" name={sos.driver_name} phone={sos.driver_phone} pressed={driverPressed} />
              </div>
            </section>

            <section className="text-sm space-y-1">
              <h3 className="text-sm font-bold text-text-primary mb-1">Ride</h3>
              <p className="flex items-center gap-2 text-text-secondary"><Car size={14} className="flex-shrink-0" />{sos.vehicle_name ?? 'Car not recorded'}{sos.number_plate ? ` · ${sos.number_plate}` : ''}</p>
              <p className="text-text-secondary">{sos.origin_address ?? '—'} → {sos.destination_address ?? '—'}</p>
              <p className="text-text-muted capitalize">Ride status: {sos.ride_status.replace(/_/g, ' ')}</p>
              {sos.previous_alerts > 0 && (
                <p className="flex items-center gap-2 text-warning font-semibold"><History size={14} className="flex-shrink-0" />{sos.previous_alerts} earlier SOS alert{sos.previous_alerts === 1 ? '' : 's'} from this {driverPressed ? 'driver' : 'rider'}</p>
              )}
              <Link href={`/rides/${sos.ride_id}`} className="inline-flex items-center gap-1.5 text-primary hover:underline pt-1"><ExternalLink size={13} /> Open the full ride</Link>
            </section>

            <section>
              <h3 className="text-sm font-bold text-text-primary mb-2">What has happened</h3>
              <ol className="space-y-3">
                {timeline(sos).map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <span className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${TONE[t.tone]}`} />
                    <div className="min-w-0"><p className="text-sm text-text-primary break-words">{t.text}</p><p className="text-xs text-text-muted">{absoluteTime(t.at)}</p></div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </div>
    </aside>
  )
}
