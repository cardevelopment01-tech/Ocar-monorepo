'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPublicTrip } from './fetch-trip'
import { LOCALE_TAG, pickLanguage, type Lang } from './i18n'
import { nextDelayMs } from './polling'
import type { PublicTrip } from './types'

export type TripState =
  /** `offline`: the first answer has failed at least once (the page says it is retrying instead of looking frozen). */
  | { status: 'loading'; offline: boolean }
  | { status: 'inactive' }
  | { status: 'live'; trip: PublicTrip; receivedAtMs: number; offline: boolean }

/**
 * Polls the public trip. Pauses while the tab is hidden and asks again the moment it is visible; a dead link ends polling;
 * a failing network keeps the last trip on screen with an "offline" flag and backs off.
 */
export function useTripPolling(token: string): TripState {
  const [state, setState] = useState<TripState>({ status: 'loading', offline: false })
  const failures = useRef(0)
  const startedAt = useRef(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let ended = false // remembered across a failed poll: a finished trip must not drop back to the 5 s pace on one network blip
    startedAt.current = Date.now()
    failures.current = 0

    const poll = async () => {
      controller?.abort()
      const mine = new AbortController()
      controller = mine
      const res = await fetchPublicTrip(token, { signal: mine.signal })
      // A request we aborted ourselves (the tab came back, or a newer poll started) is not a network failure: ignore it.
      if (cancelled || mine.signal.aborted) return
      if (res.kind === 'inactive') { setState({ status: 'inactive' }); return }
      if (res.kind === 'ok') {
        failures.current = 0
        ended = res.trip.phase === 'completed' || res.trip.phase === 'cancelled'
        setState({ status: 'live', trip: res.trip, receivedAtMs: Date.now(), offline: false })
      } else {
        failures.current += 1
        setState((s) => (s.status === 'live' || s.status === 'loading' ? { ...s, offline: true } : s))
      }
      schedule()
    }
    const schedule = () => {
      clearTimeout(timer)
      if (cancelled || document.hidden) return // resumes from onVisible
      timer = setTimeout(() => void poll(), nextDelayMs({ watchedMs: Date.now() - startedAt.current, failures: failures.current, ended }))
    }
    const onVisible = () => { if (!document.hidden && !cancelled) { clearTimeout(timer); void poll() } }

    document.addEventListener('visibilitychange', onVisible)
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [token])

  return state
}

/** A clock that ticks (for the "Updated N sec ago" text). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

const LANG_KEY = 'ocar_share_lang'

/** English on the first (server) render, then `?lang=`, the saved choice or the browser language. The choice is stored on this device only. */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>('en')
  useEffect(() => {
    let stored: string | null = null
    try { stored = window.localStorage.getItem(LANG_KEY) } catch { /* private mode: fine */ }
    setLangState(pickLanguage({ queryLang: new URLSearchParams(window.location.search).get('lang'), stored, browserLanguages: navigator.languages }))
  }, [])
  useEffect(() => { document.documentElement.lang = LOCALE_TAG[lang] }, [lang])
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { window.localStorage.setItem(LANG_KEY, l) } catch { /* private mode: fine */ }
  }, [])
  return [lang, setLang]
}
