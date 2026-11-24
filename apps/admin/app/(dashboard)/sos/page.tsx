'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, ShieldAlert, CheckCircle, Clock, AlertTriangle, ExternalLink, Phone, MapPin, MapPinOff, WifiOff, RefreshCw, Volume2, VolumeX, BellRing } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import SuccessToast from '@/components/ui/SuccessToast'
import { safetyApi, type SosAlert, type SosCounts } from '@/lib/safety-api'
import { getAdminSocket } from '@/lib/socket'
import { extractErrorCode, extractErrorMessage } from '@/lib/http-errors'
import { ACTIVE_STATUSES, SOS_FILTERS, absoluteTime, activeCount, elapsedLabel, handledBy, hasLocation, totalCount, unannounced, waitingClock, waitingTone, type SosFilter } from '@/lib/sos-model'
import { askDesktopPermission, desktopPermission, isAlarmMuted, notifyDesktop, primeAlarm, setAlarmMuted, soundAlarm } from '@/lib/sos-alarm'
import SosNoteDialog from './SosNoteDialog'
import SosDetailPanel from './SosDetailPanel'

const EMPTY_COUNTS: SosCounts = { triggered: 0, acknowledged: 0, responding: 0, resolved: 0, false_alarm: 0 }
const HISTORY_STEP = 25
const HISTORY_MAX = 100

function statusClass(s: string) {
  if (ACTIVE_STATUSES.has(s)) return 'pill-danger'
  if (s === 'resolved')       return 'pill-success'
  return 'pill-info'
}

type Pending = { id: string; kind: 'resolved' | 'false_alarm' }

export default function SOSPage() {
  const router = useRouter()
  const [active,   setActive]   = useState<SosAlert[]>([])
  const [history,  setHistory]  = useState<SosAlert[]>([])
  const [counts,   setCounts]   = useState<SosCounts>(EMPTY_COUNTS)
  const [loaded,   setLoaded]   = useState(false)
  // A failed fetch must never read as "all clear": it is shown as an error, and the last good data stays on screen, marked stale.
  const [loadFailed, setLoadFailed] = useState(false)
  const [lastOk,   setLastOk]   = useState<number | null>(null)
  const [historyLimit, setHistoryLimit] = useState(HISTORY_STEP)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [filter, setFilter] = useState<SosFilter>('all')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [desktop, setDesktop] = useState<ReturnType<typeof desktopPermission>>('unsupported')
  // null until the first load: what is already open when the page is opened is not "new".
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => { setMuted(isAlarmMuted()); setDesktop(desktopPermission()) }, [])

  const [actingId,   setActingId]   = useState<string | null>(null)
  const [cardError,  setCardError]  = useState<{ id: string; message: string } | null>(null)
  const [pending,    setPending]    = useState<Pending | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [toast,      setToast]      = useState<string | null>(null)

  // The poll, the socket and "Show more" can overlap: only the newest request may write, so an older answer arriving late
  // cannot put back a list from before an acknowledge or shrink the history.
  const latest = useRef(0)
  const load = useCallback(async () => {
    const mine = ++latest.current
    try {
      const [open, recent] = await Promise.all([
        safetyApi.getSosAlerts({ status: 'active', limit: 100 }),
        safetyApi.getSosAlerts({ limit: historyLimit, ...(filter !== 'all' ? { status: filter } : {}) }),
      ])
      if (mine !== latest.current) return
      setActive(open.alerts)
      const fresh = unannounced(seen.current, open.alerts)
      seen.current = fresh.seen
      if (fresh.ids.length > 0) {
        soundAlarm()
        const a = open.alerts.find(x => x.id === fresh.ids[0])
        notifyDesktop(fresh.ids.length === 1 ? 'New SOS alert' : `${fresh.ids.length} new SOS alerts`, a ? `${a.driver_name ?? a.user_name ?? 'Someone'} · ${a.origin_address ?? ''} → ${a.destination_address ?? ''}` : 'Open the SOS page')
      }
      setHistory(recent.alerts)
      setHistoryTotal(recent.total)
      setCounts(recent.counts ?? open.counts ?? EMPTY_COUNTS)
      setLoadFailed(false)
      setLastOk(Date.now())
    } catch {
      if (mine !== latest.current) return
      setLoadFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [historyLimit, filter])

  useEffect(() => {
    void load()
    // A new alert arrives over the ops socket; the poll is the fallback if the socket is down.
    const socket = getAdminSocket()
    const onAlert = () => void load()
    socket.on('sos:alert', onAlert)
    const poll = setInterval(() => void load(), 15_000)
    return () => { socket.off('sos:alert', onAlert); clearInterval(poll) }
  }, [load])

  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1_000)
    return () => clearInterval(id)
  }, [])

  // Oldest unresolved first: the alert that has waited longest is the most urgent.
  const queue = [...active].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  // Nothing has ever loaded and the last try failed: the numbers are unknown, not zero.
  const unknown = loadFailed && lastOk === null
  const activeTotal = activeCount(counts)
  const total = totalCount(counts)

  // Someone else got there first (409), or the alert is gone: show what the server says and refresh so the card is right.
  function handleActionError(err: unknown, fallback: string): string {
    const code = extractErrorCode(err)
    if (code === 'SOS_STATE_CONFLICT' || code === 'SOS_ALERT_NOT_FOUND') void load()
    return extractErrorMessage(err, fallback)
  }

  async function acknowledge(id: string) {
    setActingId(id)
    setCardError(null)
    try {
      await safetyApi.acknowledgeSos(id)
      await load()
    } catch (err) {
      setCardError({ id, message: handleActionError(err, 'Could not acknowledge this alert. Try again.') })
    } finally {
      setActingId(null)
    }
  }

  async function resolve(note: string) {
    if (!pending) return
    setActingId(pending.id)
    setDialogError(null)
    try {
      await safetyApi.resolveSos(pending.id, { status: pending.kind, ...(note ? { note } : {}) })
      setToast(pending.kind === 'false_alarm' ? 'Alert dismissed as a false alarm' : 'Alert closed')
      setPending(null)
      await load()
    } catch (err) {
      setDialogError(handleActionError(err, 'Could not save this. Try again.'))
    } finally {
      setActingId(null)
    }
  }

  return (
    <div className="space-y-5">
      {loadFailed && lastOk !== null && (
        <div role="alert" className="rounded-2xl px-5 py-3 border border-warning/40 bg-warning/10 flex items-center gap-3 text-sm text-text-primary">
          <WifiOff size={18} className="text-warning flex-shrink-0" />
          <p className="flex-1">
            <span className="font-bold">Can&apos;t reach the server.</span>{' '}
            {lastOk ? `This list may be out of date (last updated ${new Date(lastOk).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}). ` : ''}
            New alerts may not be showing. Keep the SOS phone line open.
          </p>
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border rounded-xl bg-surface hover:bg-surface-2">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {loaded && !loadFailed && queue.length > 0 && (
        <div
          role="alert"
          className="rounded-2xl px-5 py-4 border-2 border-danger flex items-center gap-4"
          style={{ background: 'rgba(239,68,68,0.08)' }}
        >
          <ShieldAlert size={28} className="text-danger flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-black text-danger text-lg">
              {queue.length === 1 ? '1 active SOS alert' : `${queue.length} active SOS alerts`}
            </p>
            <p className="text-sm text-danger/80 truncate">
              Longest waiting: {queue[0]?.driver_name ?? queue[0]?.user_name ?? 'Unknown'} ·{' '}
              {queue[0]?.origin_address ?? '—'} → {queue[0]?.destination_address ?? '—'}
            </p>
          </div>
          <span className="text-danger font-bold text-sm whitespace-nowrap">{queue[0] ? elapsedLabel(queue[0].created_at) : ''}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 -mb-2">
        <button
          onClick={() => { const next = !muted; setMuted(next); setAlarmMuted(next); if (!next) { primeAlarm(); soundAlarm() } }}
          aria-pressed={!muted}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border rounded-xl bg-surface hover:bg-surface-2 text-text-secondary"
        >
          {muted ? <VolumeX size={13} /> : <Volume2 size={13} />} Alarm {muted ? 'off' : 'on'}
        </button>
        {desktop === 'default' && (
          <button
            onClick={() => { primeAlarm(); askDesktopPermission(); setTimeout(() => setDesktop(desktopPermission()), 1500) }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border rounded-xl bg-surface hover:bg-surface-2 text-text-secondary"
          >
            <BellRing size={13} /> Allow desktop alerts
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Active Now"     value={unknown ? '—' : activeTotal}       change={unknown ? 'Unavailable' : activeTotal > 0 ? 'Needs action' : 'All clear'} changeType={!unknown && activeTotal > 0 ? 'down' : 'neutral'} icon={Shield}        gradient="pink"  loading={!loaded} />
        <StatCard title="Resolved"       value={unknown ? '—' : counts.resolved}    change="All time"   changeType={unknown ? 'neutral' : 'up'} icon={CheckCircle}   gradient="green" loading={!loaded} />
        <StatCard title="False Alarms"   value={unknown ? '—' : counts.false_alarm} change="All time"   changeType="neutral" icon={AlertTriangle} gradient="amber" loading={!loaded} />
        <StatCard title="Total Alerts"   value={unknown ? '—' : total}              change="All time"   changeType="neutral" icon={Clock}         gradient="blue"  loading={!loaded} />
      </div>

      {loaded && !lastOk && loadFailed && (
        <div role="alert" className="admin-card flex flex-col items-center justify-center py-12 text-center">
          <WifiOff size={40} className="text-warning mb-3" />
          <p className="font-bold text-text-primary">Can&apos;t load SOS alerts</p>
          <p className="text-sm text-text-muted mt-1 max-w-sm">This does not mean there are none. Check your connection and retry. If this keeps happening, tell engineering and watch the SOS phone line.</p>
          <button onClick={() => void load()} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-dark">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {loaded && queue.length > 0 && (
        <div>
          <h2 className="text-md font-bold text-text-primary mb-3">Active Alerts</h2>
          <div className="space-y-3">
            {queue.map(sos => {
              const phone = sos.driver_phone ?? sos.user_phone
              const who = handledBy(sos)
              const busy = actingId === sos.id
              return (
                <div
                  key={sos.id}
                  className="bg-surface rounded-2xl border border-danger/20 p-5 shadow-card"
                  style={{ background: 'rgba(239,68,68,0.04)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                        <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                        <p className="font-bold text-text-primary text-lg">{sos.driver_name ?? sos.user_name ?? 'Unknown'}</p>
                        {phone && (
                          <a href={`tel:${phone}`} className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                            <Phone size={12} />
                            {phone}
                          </a>
                        )}
                        <span className="text-xs text-text-muted">{sos.triggered_by_driver ? 'Driver alert' : 'Rider alert'}</span>
                      </div>
                      <p className="text-sm text-text-secondary">{sos.origin_address ?? '—'} → {sos.destination_address ?? '—'}</p>
                      {hasLocation(sos) ? (
                        <a
                          href={`https://www.google.com/maps?q=${sos.location_lat},${sos.location_lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                        >
                          <MapPin size={12} />
                          {parseFloat(sos.location_lat!).toFixed(4)}, {parseFloat(sos.location_lng!).toFixed(4)} (open map)
                        </a>
                      ) : (
                        <p className="inline-flex items-center gap-1 text-xs font-semibold text-warning mt-1">
                          <MapPinOff size={12} /> No location shared. Call them, or open the ride to see the last trail.
                        </p>
                      )}
                      {sos.notes && <p className="text-xs text-text-muted mt-1">Note: {sos.notes}</p>}
                      <p className="text-xs mt-2" title={absoluteTime(sos.created_at)}>
                        <span className="text-danger font-semibold">Raised {elapsedLabel(sos.created_at)}</span>
                        {sos.status === 'triggered'
                          ? <span className={waitingTone(sos.created_at) === 'ok' ? 'text-danger' : 'text-danger font-bold'}> · waiting to be acknowledged <span className="font-mono tabular-nums">{waitingClock(sos.created_at)}</span>{waitingTone(sos.created_at) === 'overdue' ? ' · OVERDUE (over 5 min)' : waitingTone(sos.created_at) === 'late' ? ' · over the 1 min target' : ''}</span>
                          : who && <span className="text-text-muted"> · {who} {elapsedLabel(sos.acknowledged_at)}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {sos.status === 'triggered' && (
                      <button
                        disabled={busy}
                        onClick={() => void acknowledge(sos.id)}
                        className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
                      >
                        {busy ? 'Acknowledging…' : 'Acknowledge'}
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => { setDialogError(null); setPending({ id: sos.id, kind: 'resolved' }) }}
                      className="px-4 py-2 text-sm font-semibold bg-success text-white rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50"
                    >
                      Mark Resolved
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => { setDialogError(null); setPending({ id: sos.id, kind: 'false_alarm' }) }}
                      className="px-4 py-2 text-sm font-semibold border border-border rounded-xl hover:bg-surface-2 transition-colors text-text-secondary disabled:opacity-50"
                    >
                      False Alarm
                    </button>
                    <button
                      onClick={() => setDetailId(sos.id)}
                      className="ml-auto px-4 py-2 text-sm font-semibold border border-primary/40 text-primary rounded-xl hover:bg-primary/5 transition-colors"
                    >
                      Details &amp; map
                    </button>
                    <button
                      onClick={() => router.push(`/rides/${sos.ride_id}`)}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border border-border rounded-xl hover:bg-surface-2 transition-colors text-text-secondary"
                    >
                      <ExternalLink size={14} />
                      View ride
                    </button>
                  </div>
                  {cardError?.id === sos.id && <p role="alert" className="text-sm text-danger mt-3">{cardError.message}</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loaded && !loadFailed && queue.length === 0 && (
        <div className="admin-card flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle size={40} className="text-success mb-3" />
          <p className="font-bold text-text-primary">No active SOS alerts</p>
          <p className="text-sm text-text-muted mt-1">Nobody has an open alert right now</p>
        </div>
      )}

      <div className="admin-card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-md font-bold text-text-primary">SOS Events</h2>
          <div role="tablist" aria-label="Filter events" className="inline-flex gap-1 p-1 rounded-xl bg-surface-2">
            {SOS_FILTERS.map(f => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => { setFilter(f.key); setHistoryLimit(HISTORY_STEP) }}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${filter === f.key ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {!loaded ? (
          <table className="data-table w-full"><tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}><td colSpan={6} className="py-3"><div className="skeleton h-4 rounded w-full" /></td></tr>
            ))}
          </tbody></table>
        ) : history.length === 0 ? (
          <p className="text-text-muted text-sm py-4 text-center">{loadFailed ? 'Could not load events' : filter === 'all' ? 'No SOS events recorded' : 'Nothing matches this filter'}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Person</th><th>Route</th><th>Status</th><th>Raised</th><th>Handled by</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(sos => (
                    <tr key={sos.id} className="group">
                      <td className="font-mono text-xs"><button onClick={() => setDetailId(sos.id)} className="text-primary hover:underline">#{sos.id}</button></td>
                      <td className="font-semibold text-text-primary">
                        {sos.driver_name ?? sos.user_name ?? 'Unknown'}
                        <span className="block text-xs font-normal text-text-muted">{sos.triggered_by_driver ? 'Driver alert' : 'Rider alert'}</span>
                      </td>
                      <td className="text-text-secondary text-sm">{sos.origin_address ?? '—'} → {sos.destination_address ?? '—'}</td>
                      <td><span className={`pill ${statusClass(sos.status)}`}>{sos.status.replace(/_/g, ' ')}</span></td>
                      <td className="text-text-muted text-sm whitespace-nowrap" title={absoluteTime(sos.created_at)}>{elapsedLabel(sos.created_at)}</td>
                      <td className="text-sm text-text-secondary">
                        {handledBy(sos) || <span className="text-text-muted">—</span>}
                        {sos.resolution_note && <span className="block text-xs text-text-muted max-w-[260px] truncate" title={sos.resolution_note}>“{sos.resolution_note}”</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {history.length >= historyLimit && historyLimit < HISTORY_MAX && historyTotal > history.length && (
              <div className="mt-4 text-center">
                <button
                  onClick={() => setHistoryLimit(n => Math.min(n + HISTORY_STEP, HISTORY_MAX))}
                  className="px-4 py-2 text-sm font-semibold border border-border rounded-xl hover:bg-surface-2 text-text-secondary"
                >
                  Show more ({history.length} of {historyTotal})
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <SosNoteDialog
        open={pending !== null}
        kind={pending?.kind ?? 'resolved'}
        loading={pending !== null && actingId === pending.id}
        error={dialogError}
        onCancel={() => setPending(null)}
        onConfirm={note => void resolve(note)}
      />
      <SosDetailPanel id={detailId} onClose={() => setDetailId(null)} />
      <SuccessToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
