'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Map as GoogleMap, AdvancedMarker, Polyline } from '@vis.gl/react-google-maps'
import { Phone, Car, History, ExternalLink, MapPinOff } from 'lucide-react'
import SlideOver from '@/components/ui/SlideOver'
import { safetyApi, type SosDetail } from '@/lib/safety-api'
import { extractErrorMessage } from '@/lib/http-errors'
import { absoluteTime, hasLocation, timeline } from '@/lib/sos-model'

const FALLBACK_CENTER = { lat: 20.2961, lng: 85.8245 }
const TONE = { danger: 'bg-danger', info: 'bg-primary', success: 'bg-success' } as const

function Person({ role, name, phone, pressed }: { role: string; name: string | null; phone: string | null; pressed: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
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

// Everything on one screen for the person handling the alert: who, in which car, where they are and have been, what has happened so far.
export default function SosDetailPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<SosDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setDetail(null)
    setError(null)
    safetyApi.getSosDetail(id)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(e => { if (!cancelled) setError(extractErrorMessage(e, 'Could not load this alert.')) })
    return () => { cancelled = true }
  }, [id])

  const sos = detail
  const trail = sos?.trail ?? []
  const last = trail[trail.length - 1]
  const point = sos && hasLocation(sos) ? { lat: parseFloat(sos.location_lat!), lng: parseFloat(sos.location_lng!) } : null
  const center = point ?? (last ? { lat: last.lat, lng: last.lng } : null) ?? FALLBACK_CENTER
  const driverPressed = !!sos?.triggered_by_driver

  return (
    <SlideOver isOpen={id !== null} onClose={onClose} title={id ? `SOS alert #${id}` : 'SOS alert'} width="lg">
      <div className="px-6 py-5">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!error && !sos && <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>}
      {sos && (
        <div className="space-y-5">
          <div className="rounded-xl overflow-hidden border border-border" style={{ height: 240 }}>
            {point || trail.length > 0 ? (
              <GoogleMap defaultCenter={center} defaultZoom={15} mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID} gestureHandling="greedy" disableDefaultUI style={{ width: '100%', height: '100%' }}>
                {trail.length >= 2 && <Polyline path={trail.map(t => ({ lat: t.lat, lng: t.lng }))} strokeColor="#0E8FA3" strokeWeight={4} strokeOpacity={0.9} />}
                {last && <AdvancedMarker position={{ lat: last.lat, lng: last.lng }}><span title="Last car position" className="block w-3.5 h-3.5 rounded-full bg-primary border-2 border-white shadow" /></AdvancedMarker>}
                {point && <AdvancedMarker position={point}><span title="Where SOS was pressed" className="block w-5 h-5 rounded-full bg-danger border-2 border-white shadow animate-pulse" /></AdvancedMarker>}
              </GoogleMap>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 text-sm text-text-muted">
                <MapPinOff size={24} className="mb-2 text-warning" />
                No position was shared and the car has sent no trail yet. Call the rider and the driver.
              </div>
            )}
          </div>
          {last && <p className="text-xs text-text-muted -mt-3">Car last seen {absoluteTime(last.recorded_at)}{last.speed_kmph != null ? `, ${Math.round(last.speed_kmph)} km/h` : ''}. Blue dot: car. Red dot: where SOS was pressed.</p>}

          <section>
            <h3 className="text-sm font-bold text-text-primary mb-1">People</h3>
            <div className="divide-y divide-border">
              <Person role="Rider" name={sos.rider_name} phone={sos.rider_phone} pressed={!driverPressed} />
              <Person role="Driver" name={sos.driver_name} phone={sos.driver_phone} pressed={driverPressed} />
            </div>
          </section>

          <section className="text-sm space-y-1">
            <h3 className="text-sm font-bold text-text-primary mb-1">Ride</h3>
            <p className="flex items-center gap-2 text-text-secondary"><Car size={14} />{sos.vehicle_name ?? 'Car not recorded'}{sos.number_plate ? ` · ${sos.number_plate}` : ''}</p>
            <p className="text-text-secondary">{sos.origin_address ?? '—'} → {sos.destination_address ?? '—'}</p>
            <p className="text-text-muted capitalize">Ride status: {sos.ride_status.replace(/_/g, ' ')}</p>
            {sos.previous_alerts > 0 && (
              <p className="flex items-center gap-2 text-warning font-semibold"><History size={14} />{sos.previous_alerts} earlier SOS alert{sos.previous_alerts === 1 ? '' : 's'} from this {driverPressed ? 'driver' : 'rider'}</p>
            )}
            <Link href={`/rides/${sos.ride_id}`} className="inline-flex items-center gap-1.5 text-primary hover:underline pt-1"><ExternalLink size={13} /> Open the full ride</Link>
          </section>

          <section>
            <h3 className="text-sm font-bold text-text-primary mb-2">What has happened</h3>
            <ol className="space-y-3">
              {timeline(sos).map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${TONE[t.tone]}`} />
                  <div><p className="text-sm text-text-primary">{t.text}</p><p className="text-xs text-text-muted">{absoluteTime(t.at)}</p></div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
      </div>
    </SlideOver>
  )
}
