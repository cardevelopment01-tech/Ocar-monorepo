'use client'
import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { UserCheck } from 'lucide-react'
import { verificationApi, type OpenChallengeItem } from '@/lib/verification-api'
import { challengeReasonText, waitingText } from '@/lib/verification-model'

// Drivers who were taken offline for a re-check and have not redone it. Waiving lets one back online without it, for
// the driver who cannot take the photos (broken camera, no light). The driver is never told why they were checked.
export default function OpenChecks() {
  const [items, setItems] = useState<OpenChallengeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      setItems(await verificationApi.challenges())
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const waive = async (id: string) => {
    setBusy(true)
    setMessage('')
    try {
      await verificationApi.waive(id)
      setItems((cur) => cur.filter((i) => i.id !== id))
    } catch (err) {
      const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined
      setMessage(code === 'ALREADY_RESOLVED' ? 'That check was already closed.' : "Couldn't waive that check. Try again.")
      if (code === 'ALREADY_RESOLVED') await load()
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  return (
    <section aria-label="Open checks" className="panel p-5">
      <p className="mb-3 text-sm text-text-muted">
        These drivers are offline until they redo the selfie and plate check. Waive one only if they cannot take the photos.
      </p>
      {message ? <p role="status" className="mb-3 text-sm text-text-muted">{message}</p> : null}
      {loading ? (
        <ul aria-busy="true">{[0, 1, 2].map((n) => <li key={n} className="my-2 h-12 animate-pulse rounded-lg bg-surface-2" />)}</ul>
      ) : loadError ? (
        <div className="text-sm">
          <p className="mb-3 text-text-muted">Couldn&apos;t load the open checks.</p>
          <button className="btn-primary" onClick={() => void load()}>Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center">
          <UserCheck className="mx-auto mb-2 h-8 w-8 text-success" aria-hidden />
          <p className="font-medium text-text-primary">All caught up</p>
          <p className="text-sm text-text-muted">No driver is waiting on a re-check.</p>
        </div>
      ) : (
        <ul>
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-text-primary">{c.driverName ?? c.driverPhone}</span>
                <span className="block text-xs text-text-muted">
                  {c.driverPhone} · {challengeReasonText(c.reason)} · waiting {waitingText(c.openedAt)}
                </span>
              </span>
              {confirming === c.id ? (
                <span className="flex items-center gap-2">
                  <button className="btn-danger" disabled={busy} onClick={() => void waive(c.id)}>Confirm waive</button>
                  <button className="btn-secondary" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
                </span>
              ) : (
                <button className="btn-secondary" onClick={() => setConfirming(c.id)}>Waive check</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
