import { useCallback, useEffect, useRef, useState } from 'react'
import { createShares, listShares, stopAllShares, stopShare } from './api'
import { errorCopy, pickReusableLink, shareErrorCode, type CreatedShare, type Share } from './model'
import { forgetShareUrl, loadShareUrls, saveShareUrl } from './urlStore'

export type TripShareBusy = 'link' | 'sms' | 'stop' | null

export interface TripShareState {
  shares: Share[]
  /** The newest link of the rider's own whose URL this phone still holds (null: create a new one). */
  reusable: { share: Share; url: string } | null
  busy: TripShareBusy
  /** Plain-words message for the last failed action, null when there is none. */
  error: string | null
  /** Reads the list again. True when the list was read, false when it could not be (what is shown is kept). */
  refresh: () => Promise<boolean>
  /** Creates the anonymous link for the phone's share sheet. Returns its URL, or null on failure (error is set). */
  createLink: () => Promise<string | null>
  /** Creates one link per chosen contact and texts each. Returns the results, or null on failure. */
  sendToContacts: (contactIds: string[]) => Promise<CreatedShare[] | null>
  stop: (shareId: string) => Promise<boolean>
  stopAll: () => Promise<boolean>
  clearError: () => void
}

/**
 * The rider's links for one trip. A create button is disabled while a request is in flight (the guard that stands in for server
 * idempotency, eng review D7). The list is read when the trip is shared-eligible and after every action; created URLs are kept on
 * the phone because the server cannot show them again (D4).
 */
export function useTripShare(rideId: string, enabled: boolean): TripShareState {
  const [shares, setShares] = useState<Share[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<TripShareBusy>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const latestRefresh = useRef(0)

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!enabled || !rideId) return false
    // Two refreshes can overlap (the sheet opens, the rider creates a link): the one that started last wins, whatever order they land in.
    const mine = ++latestRefresh.current
    try {
      const list = await listShares(rideId)
      const stored = await loadShareUrls(list.map((s) => s.id))
      if (mine !== latestRefresh.current) return true
      setShares(list)
      setUrls(stored)
      return true
    } catch {
      // Reading the list is a convenience (the banner, the manage list): a failure keeps what is shown and never blocks sharing.
      return false
    }
  }, [enabled, rideId])

  useEffect(() => { void refresh() }, [refresh])

  // One action at a time: a double tap or a retry while a request is out must not create a second link.
  const run = useCallback(async <T,>(kind: Exclude<TripShareBusy, null>, work: () => Promise<T>): Promise<T | null> => {
    if (inFlight.current) return null
    inFlight.current = true
    setBusy(kind)
    setError(null)
    try {
      return await work()
    } catch (err) {
      setError(errorCopy(shareErrorCode(err)))
      return null
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }, [])

  const create = useCallback(async (kind: 'link' | 'sms', contactIds: string[]): Promise<CreatedShare[] | null> => {
    const created = await run(kind, async () => {
      const result = await createShares(rideId, contactIds)
      await Promise.all(result.map((c) => saveShareUrl(c.id, c.url)))
      return result
    })
    if (created) await refresh()
    return created
  }, [refresh, rideId, run])

  const createLink = useCallback(async () => {
    const created = await create('link', [])
    return created?.[0]?.url ?? null
  }, [create])

  const sendToContacts = useCallback((contactIds: string[]) => create('sms', contactIds), [create])

  const stop = useCallback(async (shareId: string) => {
    const ok = await run('stop', async () => { await stopShare(rideId, shareId); await forgetShareUrl(shareId); return true })
    if (ok) await refresh()
    return ok === true
  }, [refresh, rideId, run])

  const stopAll = useCallback(async () => {
    const ids = shares.map((s) => s.id)
    const ok = await run('stop', async () => { await stopAllShares(rideId); await Promise.all(ids.map(forgetShareUrl)); return true })
    if (ok) await refresh()
    return ok === true
  }, [refresh, rideId, run, shares])

  return {
    shares,
    reusable: pickReusableLink(shares, urls),
    busy,
    error,
    refresh,
    createLink,
    sendToContacts,
    stop,
    stopAll,
    clearError: () => setError(null),
  }
}
