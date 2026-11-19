'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { broadcastApi, type BroadcastSummary } from '@/lib/broadcast-api'
import { cityApi } from '@/lib/city-api'
import { vehicleCategoryApi } from '@/lib/vehicle-api'
import { extractErrorMessage } from '@/lib/http-errors'
import { cn } from '@/lib/utils'
import { describeAudience } from './audience'

// How often the list refreshes itself while any broadcast is still going out or its push results are still arriving.
const POLL_MS = 8000

const STATUS: Record<BroadcastSummary['status'], { label: string; cls: string }> = {
  queued: { label: 'Queued', cls: 'pill-muted' },
  sending: { label: 'Sending', cls: 'pill-info' },
  done: { label: 'Sent', cls: 'pill-success' },
  failed: { label: 'Failed', cls: 'pill-danger' },
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })

const UNTRACKED = 'Sent before delivery tracking existed: only how many it was sent to is known'

/** A count; or a dash when it was not recorded (a send made before tracking). */
function Num({ value, tone, unknown }: { value: number; tone?: 'good' | 'bad' | 'muted'; unknown?: boolean }) {
  if (unknown) return <span className="text-text-muted" title={UNTRACKED}>—</span>
  return <span className={cn('tabular-nums', tone === 'good' && value > 0 && 'text-success font-semibold', tone === 'bad' && value > 0 && 'text-danger font-semibold', tone === 'muted' && 'text-text-muted')}>{value}</span>
}

export default function BroadcastHistory({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<BroadcastSummary[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cityNames, setCityNames] = useState<ReadonlyMap<number, string>>(new Map())
  const [categoryNames, setCategoryNames] = useState<ReadonlyMap<number, string>>(new Map())
  const inFlight = useRef(false)
  const reloadAfter = useRef(false)

  useEffect(() => {
    cityApi.list().then((cs) => setCityNames(new Map(cs.map((c) => [c.id, c.name])))).catch(() => {})
    vehicleCategoryApi.list().then((cs) => setCategoryNames(new Map(cs.map((c) => [Number(c.id), c.display_name])))).catch(() => {})
  }, [])

  // Reloads the newest page. Rows already loaded further down are kept, so a refresh never collapses a list the admin was reading.
  const load = useCallback(async () => {
    // A request already running may have started before this one was asked for (e.g. just sent): run once more when it ends.
    if (inFlight.current) { reloadAfter.current = true; return }
    inFlight.current = true
    try {
      const page = await broadcastApi.list({ limit: 20 })
      // Fresh rows replace their old copies and new ones are added; nothing already loaded is ever dropped (newest first).
      setRows((old) => {
        const ids = new Set(page.broadcasts.map((b) => b.id))
        return [...page.broadcasts, ...old.filter((b) => !ids.has(b.id))].sort((a, b) => Number(b.id) - Number(a.id))
      })
      setNextBefore((cur) => (cur === null || page.broadcasts.length === 0 ? page.nextBefore : cur))
      setError(null)
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not load the sent broadcasts.'))
    } finally {
      inFlight.current = false
      setLoading(false)
      if (reloadAfter.current) { reloadAfter.current = false; void load() }
    }
  }, [])

  useEffect(() => { void load() }, [load, refreshKey])

  const settling = rows.some((b) => b.settling)
  useEffect(() => {
    if (!settling) return
    const t = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(t)
  }, [settling, load])

  const loadMore = async () => {
    if (!nextBefore) return
    setLoadingMore(true)
    try {
      const page = await broadcastApi.list({ limit: 20, before: nextBefore })
      setRows((old) => [...old, ...page.broadcasts])
      setNextBefore(page.nextBefore)
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not load more.'))
    } finally {
      setLoadingMore(false)
    }
  }

  const names = useMemo(() => ({ cities: cityNames, categories: categoryNames }), [cityNames, categoryNames])

  return (
    <div className="admin-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">Sent broadcasts</p>
          <p className="text-xs text-text-muted mt-0.5">What happened to each one. {settling ? 'Updating while results come in…' : ''}</p>
        </div>
        <button onClick={() => void load()} className="btn-secondary flex items-center gap-1.5 text-xs" aria-label="Refresh">
          <RefreshCw size={12} className={cn(settling && 'animate-spin motion-reduce:animate-none')} /> Refresh
        </button>
      </div>

      {error && <p role="alert" className="text-xs text-error">{error}</p>}

      {loading ? (
        <div className="space-y-2" aria-label="Loading">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton motion-reduce:animate-none h-10 rounded-lg" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted py-6 text-center">No broadcasts sent yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                <th className="py-2 pr-4 font-semibold">Message</th>
                <th className="py-2 pr-4 font-semibold">Sent to</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold text-right" title="People an in-app notification was created for">Notified</th>
                <th className="py-2 pr-4 font-semibold text-right" title="Firebase accepted the push for at least one of their phones. It does not prove they saw it.">Pushed</th>
                <th className="py-2 pr-4 font-semibold text-right" title="No registered phone, or the push result has not come back yet">In-app only</th>
                <th className="py-2 pr-4 font-semibold text-right" title="Firebase refused every phone (a phone that no longer exists is removed from our list)">Refused</th>
                <th className="py-2 pr-4 font-semibold text-right" title="Opened the notification in the app's notification list. Tapping the push itself is not counted yet.">Opened</th>
                <th className="py-2 font-semibold text-right" title="Matched the audience but left out: switched this type off, or already got the daily limit (offers only: 2 a day; at the check, or by the time it was sent)">Left out</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const status = STATUS[b.status]
                return (
                  <tr key={b.id} className="border-t border-border-light align-top">
                    <td className="py-3 pr-4 max-w-xs">
                      <p className="font-semibold text-text-primary truncate" title={b.title}>{b.title}</p>
                      <p className="text-xs text-text-muted truncate" title={b.body}>{b.body}</p>
                      <p className="text-[11px] text-text-muted mt-0.5">
                        {when(b.createdAt)}{b.sentBy ? ` · ${b.sentBy}` : ''}{b.category === 'offer' ? ' · offer' : ''}{b.tracked ? '' : ' · before tracking'}
                      </p>
                    </td>
                    <td className="py-3 pr-4 text-xs text-text-secondary max-w-[14rem]">{describeAudience(b.audience, names)}</td>
                    <td className="py-3 pr-4">
                      <span className={status.cls}>{status.label}</span>
                      {b.statusNote ? <span className="block text-[11px] text-danger mt-1 max-w-[16rem]">{b.statusNote}{b.status === 'failed' ? ` Reached ${b.sent} of ${b.promised}.` : ''}</span> : null}
                    </td>
                    <td className="py-3 pr-4 text-right"><Num value={b.sent} /></td>
                    <td className="py-3 pr-4 text-right"><Num value={b.pushed} tone="good" unknown={!b.tracked} /></td>
                    <td className="py-3 pr-4 text-right"><Num value={b.noPush} tone="muted" unknown={!b.tracked} />{b.settling && b.noPush > 0 ? <span className="text-text-muted">*</span> : null}</td>
                    <td className="py-3 pr-4 text-right"><Num value={b.pushFailed} tone="bad" unknown={!b.tracked} /></td>
                    <td className="py-3 pr-4 text-right"><Num value={b.opened} unknown={!b.tracked} /></td>
                    <td className="py-3 text-right"><Num value={b.skippedOptedOut + b.skippedCapped + b.skippedAtSend} tone="muted" />{b.failed > 0 ? <span className="block text-[11px] text-danger">{b.failed} not sent</span> : null}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {nextBefore && (
            <div className="pt-3">
              <button onClick={() => void loadMore()} disabled={loadingMore} className="btn-secondary text-xs disabled:opacity-50">
                {loadingMore ? 'Loading…' : 'Show older'}
              </button>
            </div>
          )}
          <p className="text-[11px] text-text-muted pt-3">
            Pushed means Firebase accepted it, not that the person saw it. * Still counting: results arrive for a couple of minutes after sending.
          </p>
        </div>
      )}
    </div>
  )
}
