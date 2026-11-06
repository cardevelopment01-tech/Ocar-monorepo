'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { CheckCircle2, Clock, Navigation, Phone, Search, Share2, TriangleAlert, WifiOff, XCircle } from 'lucide-react'

import { haversineMetres } from '@/lib/geo'
import { useLang, useNow, useTripPolling } from '@/lib/trip-share/hooks'
import { LANGS, LOCALE_TAG, t, type Lang } from '@/lib/trip-share/i18n'
import { headline, mapLabel, statusView, vehicleLine, type PillTone } from '@/lib/trip-share/status'
import type { PublicTrip } from '@/lib/trip-share/types'
import TripPlate from './TripPlate'

// The public live-trip page (/t/<token>). Opened by a relative from a chat message: no app, no login. Map first, with a fixed sheet
// whose reading order is: status, number plate (the hero), vehicle and driver, route. See docs/superpowers/plans/2026-11-06-live-trip-sharing.md.
//
// The map is loaded as its own chunk: the sheet (status, plate, route) is what a worried relative needs first, and it must not wait
// for the Google Maps code to download on a slow connection.
const TripMap = dynamic(() => import('./TripMap'), { ssr: false, loading: () => <div className="h-full w-full bg-surface-2" /> })

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

// Each row of the sheet rises in a beat after the one above it (first load only; reduced-motion viewers get none of it).
const rise = (i: number): { className: string; style: CSSProperties } => ({ className: 'motion-safe:animate-row-in', style: { animationDelay: `${120 + i * 55}ms` } })

function ToneIcon({ phase, stale }: { phase: PublicTrip['phase']; stale: boolean }) {
  if (stale) return <Clock aria-hidden size={16} />
  if (phase === 'finding_driver') return <Search aria-hidden size={16} />
  if (phase === 'completed') return <CheckCircle2 aria-hidden size={16} />
  if (phase === 'cancelled') return <XCircle aria-hidden size={16} />
  return <Navigation aria-hidden size={16} />
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
          className={`min-h-[44px] min-w-[44px] rounded-full px-3 text-[13px] transition-colors duration-200 ${l.code === lang ? 'bg-primary-subtle font-bold text-primary-dark' : 'font-medium text-text-secondary'} ${FOCUS}`}
        >
          {l.label}
        </button>
      ))}
    </nav>
  )
}

function Footer({ lang, onLang, style, className = '' }: { lang: Lang; onLang: (l: Lang) => void; style?: CSSProperties; className?: string }) {
  return (
    <footer style={style} className={`mt-4 flex items-center justify-between gap-2 border-t border-border pt-2 ${className}`}>
      <span className="text-[12px] font-medium text-text-muted">{t(lang, 'footer.shared')}</span>
      <LanguageSwitcher lang={lang} onChange={onLang} />
    </footer>
  )
}

function Reconnecting({ lang }: { lang: Lang }) {
  return (
    <p role="status" className="pointer-events-auto flex items-center gap-2 self-center rounded-full bg-[#FEF3C7] px-4 py-2 text-[13px] font-semibold text-[#92400E] shadow-card motion-safe:animate-fade-in">
      <WifiOff aria-hidden size={16} />
      {t(lang, 'banner.reconnecting')}
    </p>
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
    <div role="alert" className="pointer-events-auto rounded-2xl bg-[#FEE2E2] p-3 text-[#991B1B] shadow-card motion-safe:animate-fade-up">
      <p className="flex items-start gap-2 text-[15px] font-bold leading-snug">
        <TriangleAlert aria-hidden size={20} className="mt-0.5 flex-shrink-0" />
        <span>{text}</span>
      </p>
      <div className="mt-3 flex gap-2">
        <a href="tel:112" className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-status-error px-4 text-[15px] font-bold text-white transition-transform active:scale-[0.98] ${FOCUS}`}>
          <Phone aria-hidden size={18} />
          {t(lang, 'sos.call112')}
        </a>
        <button type="button" onClick={() => void share()} className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 text-[15px] font-bold text-[#991B1B] transition-transform active:scale-[0.98] ${FOCUS}`}>
          <Share2 aria-hidden size={18} />
          {copied ? t(lang, 'sos.copied') : t(lang, 'sos.share')}
        </button>
      </div>
    </div>
  )
}

function Inactive({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center motion-safe:animate-fade-up">
      <XCircle aria-hidden size={40} className="text-text-muted" />
      <h1 className="mt-4 text-[22px] font-bold leading-tight text-text-primary" style={{ fontFamily: DISPLAY_FONT }}>{t(lang, 'screen.inactiveTitle')}</h1>
      <p className="mt-2 max-w-xs text-[16px] leading-relaxed text-text-secondary">{t(lang, 'screen.inactiveBody')}</p>
      <div className="mt-8"><Footer lang={lang} onLang={onLang} /></div>
    </div>
  )
}

function Loading({ lang, offline }: { lang: Lang; offline: boolean }) {
  const bar = 'rounded-lg bg-[length:200%_100%] bg-gradient-to-r from-surface-2 via-border-light to-surface-2 motion-safe:animate-shimmer'
  return (
    <div className="flex h-full flex-col justify-end" aria-busy="true">
      <p className="sr-only" role="status">{t(lang, 'screen.loading')}</p>
      {offline && <div className="absolute inset-x-0 top-0 flex justify-center p-3"><Reconnecting lang={lang} /></div>}
      <div className="mx-auto w-full rounded-t-3xl bg-surface px-5 pb-8 pt-5 shadow-sheet md:max-w-[430px]">
        <div className={`h-8 w-56 rounded-full ${bar}`} />
        <div className={`mt-4 h-6 w-40 ${bar}`} />
        <div className={`mt-4 h-14 w-60 rounded-xl ${bar}`} />
        <div className={`mt-4 h-5 w-48 ${bar}`} />
      </div>
    </div>
  )
}

/**
 * The status pill and its freshness line. This is the ONLY part of the page that follows the one-second clock, so the map and the
 * rest of the sheet are not re-rendered every second just to count "Updated 5 sec ago" upwards.
 */
function StatusRegion({ trip, lang, receivedAtMs, formatTime }: { trip: PublicTrip; lang: Lang; receivedAtMs: number; formatTime: (d: Date) => string }) {
  const now = useNow(1000)
  const view = statusView({ trip, lang, receivedAtMs, nowMs: now, formatTime })
  const steady = statusView({ trip: { ...trip, etaMin: null }, lang, receivedAtMs, nowMs: now, formatTime })
  // Announced to screen readers only when the phase or the live/stale state changes: never on every poll or every second.
  const announce = view.stale ? `${steady.text}. ${t(lang, 'status.staleAnnounce')}` : steady.text
  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-semibold leading-snug transition-colors duration-300 ${TONE[view.tone]}`}>
          <ToneIcon phase={trip.phase} stale={view.stale} />
          {view.text}
        </span>
        {view.freshness && <span className="text-[13px] tabular-nums text-text-muted">{view.freshness}</span>}
      </div>
    </>
  )
}

function LiveTrip({ trip, lang, receivedAtMs, offline, onLang }: { trip: PublicTrip; lang: Lang; receivedAtMs: number; offline: boolean; onLang: (l: Lang) => void }) {
  const sheetRef = useRef<HTMLElement | null>(null)
  const [sheetH, setSheetH] = useState(280)
  const formatTime = useMemo(() => {
    const f = new Intl.DateTimeFormat(LOCALE_TAG[lang], { hour: 'numeric', minute: '2-digit' })
    return (d: Date) => f.format(d)
  }, [lang])

  // The map frames the car inside the part of the screen the sheet does not cover.
  useEffect(() => {
    const el = sheetRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setSheetH(Math.round(el.getBoundingClientRect().height)))
    ro.observe(el)
    setSheetH(Math.round(el.getBoundingClientRect().height))
    return () => ro.disconnect()
  }, [])

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
        {offline && <Reconnecting lang={lang} />}
        {trip.isSos && <SosBanner trip={trip} lang={lang} />}
      </div>

      <section
        ref={sheetRef}
        className="absolute bottom-0 z-10 max-h-[50dvh] min-h-[36dvh] w-full overflow-y-auto rounded-t-3xl bg-surface px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-5 shadow-sheet motion-safe:animate-sheet-in md:left-1/2 md:max-w-[430px] md:-translate-x-1/2"
      >
        <div {...rise(0)}>
          <StatusRegion trip={trip} lang={lang} receivedAtMs={receivedAtMs} formatTime={formatTime} />
        </div>

        <h1 className={`mt-3 text-[22px] font-bold leading-tight tracking-[-0.02em] ${rise(1).className}`} style={{ fontFamily: DISPLAY_FONT, ...rise(1).style }}>{headline(trip, lang)}</h1>

        {trip.vehicle.plate && <div className={`mt-3 ${rise(2).className}`} style={rise(2).style}><TripPlate plate={trip.vehicle.plate} /></div>}

        {(vehicle || trip.driverFirstName) && (
          <p className={`mt-3 text-[16px] leading-relaxed text-text-primary ${rise(3).className}`} style={rise(3).style}>
            {vehicle}
            {vehicle && trip.driverFirstName ? ' · ' : ''}
            {trip.driverFirstName ? `${t(lang, 'label.driver')}: ${trip.driverFirstName}` : ''}
          </p>
        )}

        <dl className={`mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[16px] leading-relaxed ${rise(4).className}`} style={rise(4).style}>
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

        <Footer lang={lang} onLang={onLang} className={rise(5).className} style={rise(5).style} />
      </section>
    </>
  )
}

export default function TripShareView() {
  const { token } = useParams<{ token: string }>()
  const state = useTripPolling(token ?? '')
  const [lang, setLang] = useLang()

  return (
    <main className="fixed inset-0 overflow-hidden bg-background text-text-primary" style={{ fontFamily: FONT }}>
      {state.status === 'loading' && <Loading lang={lang} offline={state.offline} />}
      {state.status === 'inactive' && <Inactive lang={lang} onLang={setLang} />}
      {state.status === 'live' && <LiveTrip trip={state.trip} lang={lang} receivedAtMs={state.receivedAtMs} offline={state.offline} onLang={setLang} />}
    </main>
  )
}
