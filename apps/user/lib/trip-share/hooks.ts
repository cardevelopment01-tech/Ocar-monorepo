'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { bearingDeg } from '../geo'
import { fetchPublicTrip } from './fetch-trip'
import { LOCALE_TAG, pickLanguage, type Lang } from './i18n'
import { lerpPosition, planGlide } from './glide'
import { nextDelayMs } from './polling'
import type { PublicTrip } from './types'

export type TripState =
  | { status: 'loading' }
  | { status: 'inactive' }
  | { status: 'live'; trip: PublicTrip; receivedAtMs: number; offline: boolean }

/**
 * Polls the public trip. Pauses while the tab is hidden and asks again the moment it is visible; a dead link ends polling;
 * a failing network keeps the last trip on screen with an "offline" flag and backs off.
 */
export function useTripPolling(token: string): TripState {
  const [state, setState] = useState<TripState>({ status: 'loading' })
  const failures = useRef(0)
  const startedAt = useRef(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    startedAt.current = Date.now()
    failures.current = 0

    const poll = async () => {
      controller?.abort()
      controller = new AbortController()
      const res = await fetchPublicTrip(token, { signal: controller.signal })
      if (cancelled) return
      if (res.kind === 'inactive') { setState({ status: 'inactive' }); return }
      let ended = false
      if (res.kind === 'ok') {
        failures.current = 0
        ended = res.trip.phase === 'completed' || res.trip.phase === 'cancelled'
        setState({ status: 'live', trip: res.trip, receivedAtMs: Date.now(), offline: false })
      } else {
        failures.current += 1
        setState((s) => (s.status === 'live' ? { ...s, offline: true } : s))
      }
      schedule(ended)
    }
    const schedule = (ended: boolean) => {
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

/**
 * The car position to draw: glides between reported positions over the polling interval, or snaps (first position, a jump over
 * 300 m, a hidden tab, reduced motion). Heading comes from the report, else from the direction of travel.
 */
export function useGlidedCar(report: { lat: number; lng: number; heading: number | null } | null): { position: [number, number]; heading: number | null } | null {
  const [shown, setShown] = useState<{ position: [number, number]; heading: number | null } | null>(null)
  const current = useRef<[number, number] | null>(null)
  const lastReportAt = useRef(0)
  const lastTarget = useRef<[number, number] | null>(null)
  const raf = useRef<number | undefined>(undefined)

  const lat = report?.lat
  const lng = report?.lng
  const reportedHeading = report?.heading ?? null

  useEffect(() => {
    if (lat === undefined || lng === undefined) { setShown(null); current.current = null; lastTarget.current = null; return }
    const to: [number, number] = [lat, lng]
    const now = Date.now()
    const heading = reportedHeading ?? (lastTarget.current ? bearingDeg(lastTarget.current, to) : null)
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const plan = planGlide({ from: current.current, to, sinceLastMs: lastReportAt.current ? now - lastReportAt.current : 0, hidden: document.hidden, reducedMotion: reduced })
    lastReportAt.current = now
    lastTarget.current = to
    if (raf.current !== undefined) cancelAnimationFrame(raf.current)

    if (plan.snap) {
      current.current = to
      setShown({ position: to, heading })
      return
    }
    const from = current.current!
    const t0 = performance.now()
    const step = (t: number) => {
      const k = (t - t0) / plan.durationMs
      const p = lerpPosition(from, to, k)
      current.current = p
      setShown({ position: p, heading })
      if (k < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => { if (raf.current !== undefined) cancelAnimationFrame(raf.current) }
  }, [lat, lng, reportedHeading])

  return shown
}
