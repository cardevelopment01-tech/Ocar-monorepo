'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, Clock, Navigation, Phone, Share2, WifiOff, XCircle, TriangleAlert } from 'lucide-react'

import { haversineMetres } from '@/lib/geo'
import { useLang, useNow, useTripPolling } from '@/lib/trip-share/hooks'
import { LANGS, LOCALE_TAG, t, type Lang } from '@/lib/trip-share/i18n'
import { headline, mapLabel, statusView, vehicleLine, type PillTone } from '@/lib/trip-share/status'
import type { PublicTrip } from '@/lib/trip-share/types'
import TripMap from './TripMap'
import TripPlate from './TripPlate'

// The public live-trip page (/t/<token>). Opened by a relative from a chat message: no app, no login. Map first, with a fixed sheet
// whose reading order is: status, number plate (the hero), vehicle and driver, route. See docs/superpowers/plans/2026-11-06-live-trip-sharing.md.

const FONT = 'var(--font-sans), var(--font-deva), var(--font-orya), sans-serif'
const DISPLAY_FONT = 'var(--font-display), var(--font-deva), var(--font-orya), sans-serif'
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

// Pill colours chosen for 4.5:1 text contrast on their own background (DESIGN.md's chip text colours are lighter than that).
const TONE: Record<PillTone, string> = {
  info: 'bg-[#E0F2FE] text-[#0369A1]',
  success: 'bg-[#D1FAE5] text-[#047857]',
  warning: 'bg-[#FEF3C7] text-[#92400E]',
  muted: 'bg-[#F1F5F9] text-[#475569]',
}

function ToneIcon({ tone, phase }: { tone: PillTone; phase: PublicTrip['phase'] }) {
  if (tone === 'warning') return <Clock aria-hidden size={16} />
  if (phase === 'completed') return <CheckCircle2 aria-hidden size={16} />
  if (phase === 'cancelled') return <XCircle aria-hidden size={16} />
  return <Navigation aria-hidden size={16} />
}

const timeFormatter = (lang: Lang) => {
  const f = new Intl.DateTimeFormat(LOCALE_TAG[lang], { hour: 'numeric', minute: '2-digit' })
  return (d: Date) => f.format(d)
}

function LanguageSwitcher({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <nav aria-label={t(lang, 'lang.label')} className="flex items-center">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => onChange(l.code)}
          aria-current={l.code === lang ? 'true' : undefined}
          lang={l.code}
          className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-[13px] ${l.code === lang ? 'bg-primary-subtle font-bold text-primary-dark' : 'font-medium text-text-secondary'} ${FOCUS}`}
        >
          {l.label}
        </button>
      ))}
    </nav>
  )
}

function Footer({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  return (
    <footer className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-2">
      <span className="text-[12px] font-medium text-text-muted">{t(lang, 'footer.shared')}</span>
      <LanguageSwitcher lang={lang} onChange={onLang} />
    </footer>
  )
}

function SosBanner({ trip, lang }: { trip: PublicTrip; lang: Lang }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ url })
      else { await navigator.clipboard.writeText(url); setCopied(true) }
    } catch { /* the viewer closed the share sheet */ }
  }
  const text = trip.riderFirstName ? t(lang, 'sos.banner', { name: trip.riderFirstName }) : t(lang, 'sos.bannerAnon')
  return (
    <div role="alert" className="pointer-events-auto rounded-2xl bg-[#FEE2E2] p-3 text-[#991B1B] shadow-card">
      <p className="flex items-start gap-2 text-[15px] font-bold leading-snug">
        <TriangleAlert aria-hidden size={20} className="mt-0.5 flex-shrink-0" />
        <span>{text}</span>
      </p>
      <div className="mt-3 flex gap-2">
        <a href="tel:112" className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-status-error px-4 text-[15px] font-bold text-white ${FOCUS}`}>
          <Phone aria-hidden size={18} />
          {t(lang, 'sos.call112')}
        </a>
        <button type="button" onClick={() => void share()} className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 text-[15px] font-bold text-[#991B1B] ${FOCUS}`}>
          <Share2 aria-hidden size={18} />
          {copied ? '✓' : t(lang, 'sos.share')}
        </button>
      </div>
    </div>
  )
}

function Inactive({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <XCircle aria-hidden size={40} className="text-text-muted" />
      <h1 className="mt-4 text-[22px] font-bold leading-tight text-text-primary" style={{ fontFamily: DISPLAY_FONT }}>{t(lang, 'screen.inactiveTitle')}</h1>
      <p className="mt-2 max-w-xs text-[16px] leading-relaxed text-text-secondary">{t(lang, 'screen.inactiveBody')}</p>
      <div className="mt-8"><Footer lang={lang} onLang={onLang} /></div>
    </div>
  )
}

function Loading({ lang }: { lang: Lang }) {
  return (
    <div className="flex h-full flex-col justify-end" aria-busy="true">
      <p className="sr-only" role="status">{t(lang, 'screen.loading')}</p>
      <div className="mx-auto w-full rounded-t-3xl bg-surface px-5 pb-8 pt-5 shadow-sheet md:max-w-[430px]">
        <div className="h-8 w-56 rounded-full bg-surface-2 motion-safe:animate-pulse" />
        <div className="mt-4 h-6 w-40 rounded-lg bg-surface-2 motion-safe:animate-pulse" />
        <div className="mt-4 h-14 w-60 rounded-xl bg-surface-2 motion-safe:animate-pulse" />
        <div className="mt-4 h-5 w-48 rounded-lg bg-surface-2 motion-safe:animate-pulse" />
      </div>
    </div>
  )
}

export default function TripShareView() {
  const { token } = useParams<{ token: string }>()
  const state = useTripPolling(token ?? '')
  const [lang, setLang] = useLang()
  const now = useNow(1000)
  const sheetRef = useRef<HTMLElement | null>(null)
  const [sheetH, setSheetH] = useState(280)

  // The map frames the car inside the part of the screen the sheet does not cover.
  useEffect(() => {
    const el = sheetRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setSheetH(Math.round(el.getBoundingClientRect().height)))
    ro.observe(el)
    setSheetH(Math.round(el.getBoundingClientRect().height))
    return () => ro.disconnect()
  }, [state.status])

  return (
    <main className="fixed inset-0 overflow-hidden bg-background text-text-primary" style={{ fontFamily: FONT }}>
      {state.status === 'loading' && <Loading lang={lang} />}
      {state.status === 'inactive' && <Inactive lang={lang} onLang={setLang} />}
      {state.status === 'live' && (() => {
        const { trip, receivedAtMs, offline } = state
        const view = statusView({ trip, lang, receivedAtMs, nowMs: now, formatTime: timeFormatter(lang) })
        const steady = statusView({ trip: { ...trip, etaMin: null }, lang, receivedAtMs, nowMs: now, formatTime: timeFormatter(lang) })
        // Announced to screen readers only when the phase or the live/stale state changes: never on every poll or every second.
        const announce = view.stale ? `${steady.text}. ${t(lang, 'status.staleAnnounce')}` : steady.text
        const target = trip.phase === 'driver_on_way' ? trip.pickup : trip.drop ?? trip.pickup
        const km = trip.driver ? haversineMetres([trip.driver.lat, trip.driver.lng], [target.lat, target.lng]) / 1000 : null
        const vehicle = vehicleLine(trip.vehicle)
        const pendingStops = trip.stops.filter((s) => s.status === 'pending')
        return (
          <>
            <div className="absolute inset-0">
              <TripMap trip={trip} lang={lang} bottomPad={sheetH} label={mapLabel(lang, km)} />
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto flex max-w-[430px] flex-col gap-2 p-3">
              {offline && (
                <p role="status" className="pointer-events-auto flex items-center gap-2 self-center rounded-full bg-[#FEF3C7] px-4 py-2 text-[13px] font-semibold text-[#92400E] shadow-card">
                  <WifiOff aria-hidden size={16} />
                  {t(lang, 'banner.reconnecting')}
                </p>
              )}
              {trip.isSos && <SosBanner trip={trip} lang={lang} />}
            </div>

            <section
              ref={sheetRef}
              className="absolute bottom-0 z-10 max-h-[50dvh] min-h-[36dvh] w-full overflow-y-auto rounded-t-3xl bg-surface px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-5 shadow-sheet md:left-1/2 md:max-w-[430px] md:-translate-x-1/2"
            >
              <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-semibold leading-snug ${TONE[view.tone]}`}>
                  <ToneIcon tone={view.tone} phase={trip.phase} />
                  {view.text}
                </span>
                {view.freshness && <span className="text-[13px] tabular-nums text-text-muted">{view.freshness}</span>}
              </div>

              <h1 className="mt-3 text-[22px] font-bold leading-tight tracking-[-0.02em]" style={{ fontFamily: DISPLAY_FONT }}>{headline(trip, lang)}</h1>

              <div className="mt-3"><TripPlate plate={trip.vehicle.plate} /></div>

              {(vehicle || trip.driverFirstName) && (
                <p className="mt-3 text-[16px] leading-relaxed text-text-primary">
                  {vehicle}
                  {vehicle && trip.driverFirstName ? ' · ' : ''}
                  {trip.driverFirstName ? `${t(lang, 'label.driver')}: ${trip.driverFirstName}` : ''}
                </p>
              )}

              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[16px] leading-relaxed">
                <dt className="font-semibold text-text-secondary">{t(lang, 'label.from')}</dt>
                <dd>{trip.pickup.label ?? '—'}</dd>
                {pendingStops.length > 0 && (
                  <>
                    <dt className="font-semibold text-text-secondary">{t(lang, 'label.stops')}</dt>
                    <dd>{pendingStops.map((s) => s.label ?? '—').join(', ')}</dd>
                  </>
                )}
                {trip.drop && (
                  <>
                    <dt className="font-semibold text-text-secondary">{t(lang, 'label.to')}</dt>
                    <dd>{trip.drop.label ?? '—'}</dd>
                  </>
                )}
              </dl>

              <Footer lang={lang} onLang={setLang} />
            </section>
          </>
        )
      })()}
    </main>
  )
}
