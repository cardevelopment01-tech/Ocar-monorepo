'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { CheckCircle2, Clock, Navigation, Phone, Search, Share2, TriangleAlert, User, WifiOff, XCircle } from 'lucide-react'

import { haversineMetres } from '@/lib/geo'
import { useLang, useNow, useTripPolling } from '@/lib/trip-share/hooks'
import { LANGS, LOCALE_TAG, t, type Lang } from '@/lib/trip-share/i18n'
import { headline, mapLabel, statusView, vehicleLine, type PillTone } from '@/lib/trip-share/status'
import type { PublicTrip } from '@/lib/trip-share/types'
import TripPlate from './TripPlate'

// The public live-trip page (/t/<token>). Opened by a relative from a chat message: no app, no login. Map first, with a bottom
// sheet read in one glance: state chip, the arrival time (the thing a relative came for), the number plate, the route. The driver
// row and the footer note fold away so short phones keep the map and the destination in view. See
// docs/superpowers/plans/2026-11-06-live-trip-sharing.md.
//
// The map is loaded as its own chunk: the sheet is what a worried relative needs first, and it must not wait for the Google Maps
// code to download on a slow connection.
const TripMap = dynamic(() => import('./TripMap'), { ssr: false, loading: () => <div className="h-full w-full bg-surface-2" /> })

const FONT = 'var(--font-sans), var(--font-deva), var(--font-orya), sans-serif'
const DISPLAY_FONT = 'var(--font-display), var(--font-deva), var(--font-orya), sans-serif'
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

// Chip colours chosen for 4.5:1 text contrast on their own background (DESIGN.md's chip text colours are lighter than that).
const TONE: Record<PillTone, { chip: string; dot: string }> = {
  info: { chip: 'bg-[#E8F6FD] text-[#0369A1]', dot: 'bg-[#0EA5E9]' },
  success: { chip: 'bg-[#E3F7EE] text-[#047857]', dot: 'bg-[#10B981]' },
  warning: { chip: 'bg-[#FEF3C7] text-[#92400E]', dot: 'bg-[#F59E0B]' },
  muted: { chip: 'bg-[#F1F5F9] text-[#475569]', dot: 'bg-[#94A3B8]' },
}

/** A pulsing dot while the trip is live (the one motion that says "this is moving now"); an icon for states with nothing moving. */
function StateMark({ tone, phase, stale }: { tone: PillTone; phase: PublicTrip['phase']; stale: boolean }) {
  if (stale) return <Clock aria-hidden size={14} />
  if (phase === 'finding_driver') return <Search aria-hidden size={14} />
  if (phase === 'completed') return <CheckCircle2 aria-hidden size={14} />
  if (phase === 'cancelled') return <XCircle aria-hidden size={14} />
  if (phase === 'inactive') return <Navigation aria-hidden size={14} />
  return (
    <span aria-hidden className="relative flex h-2.5 w-2.5">
      <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping ${TONE[tone].dot}`} />
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${TONE[tone].dot}`} />
    </span>
  )
}

/** Three short buttons (EN, हि, ଓ). 32 px to look at, 44 px to touch: the ::before grows the hit area without growing the control. */
function LanguageSwitcher({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <nav aria-label={t(lang, 'lang.label')} className="flex flex-shrink-0 items-center gap-0.5 rounded-full bg-surface-2 p-1 ring-1 ring-border">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => onChange(l.code)}
          aria-current={l.code === lang ? 'true' : undefined}
          aria-label={l.label}
          lang={l.code}
          className={`relative h-8 min-w-[40px] rounded-full px-2 text-[14px] leading-none transition-colors duration-200 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] ${l.code === lang ? 'bg-white font-semibold text-primary-dark shadow-ambient' : 'font-medium text-text-secondary'} ${FOCUS}`}
        >
          {l.short}
        </button>
      ))}
    </nav>
  )
}

function Reconnecting({ lang }: { lang: Lang }) {
  return (
    <p role="status" className="pointer-events-auto flex items-center gap-2 self-center rounded-full bg-[#FEF3C7] px-4 py-2 text-[14px] font-semibold text-[#92400E] shadow-float ring-1 ring-[#F59E0B]/30 motion-safe:animate-fade-in">
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
    <div role="alert" className="pointer-events-auto rounded-3xl bg-gradient-to-br from-[#E11D48] to-[#B91C1C] p-4 text-white shadow-[0_10px_32px_rgba(185,28,28,0.38)] motion-safe:animate-fade-up">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/20">
          <TriangleAlert size={20} />
        </span>
        <p className="pt-0.5 text-[16px] font-semibold leading-snug">{text}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <a href="tel:112" className={`flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-white px-4 text-[15px] font-bold text-[#B91C1C] transition-transform active:scale-[0.97] ${FOCUS}`}>
          <Phone aria-hidden size={18} />
          {t(lang, 'sos.call112')}
        </a>
        <button type="button" onClick={() => void share()} className={`flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-white/15 px-4 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/40 transition-transform active:scale-[0.97] ${FOCUS}`}>
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
      <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-text-muted ring-1 ring-border"><XCircle size={30} /></span>
      <h1 className="mt-5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-text-primary" style={{ fontFamily: DISPLAY_FONT }}>{t(lang, 'screen.inactiveTitle')}</h1>
      <p className="mt-2 max-w-xs text-[16px] leading-relaxed text-text-secondary">{t(lang, 'screen.inactiveBody')}</p>
      <div className="mt-8"><LanguageSwitcher lang={lang} onChange={onLang} /></div>
    </div>
  )
}

function Loading({ lang, offline }: { lang: Lang; offline: boolean }) {
  const bar = 'rounded-lg bg-[length:200%_100%] bg-gradient-to-r from-surface-2 via-border-light to-surface-2 motion-safe:animate-shimmer'
  return (
    <div className="flex h-full flex-col justify-end" aria-busy="true">
      <p className="sr-only" role="status">{t(lang, 'screen.loading')}</p>
      {offline && <div className="absolute inset-x-0 top-0 flex justify-center p-3"><Reconnecting lang={lang} /></div>}
      <div className="mx-auto w-full rounded-t-[32px] bg-surface px-5 pb-8 pt-6 shadow-sheet md:max-w-[430px]">
        <div className={`h-7 w-40 rounded-full ${bar}`} />
        <div className={`mt-4 h-8 w-64 ${bar}`} />
        <div className={`mt-5 h-16 w-full rounded-2xl ${bar}`} />
        <div className={`mt-5 h-5 w-52 ${bar}`} />
      </div>
    </div>
  )
}

/**
 * The top of the sheet: state chip, language, the arrival time, and the freshness line. This is the ONLY part of the page that
 * follows the one-second clock, so the map and the rest of the sheet are not re-rendered every second just to count
 * "Updated 5 sec ago" upwards. The arrival time itself is anchored to the server clock and never creeps.
 */
function StatusRegion({ trip, lang, onLang, receivedAtMs, formatTime }: { trip: PublicTrip; lang: Lang; onLang: (l: Lang) => void; receivedAtMs: number; formatTime: (d: Date) => string }) {
  const now = useNow(1000)
  const view = statusView({ trip, lang, receivedAtMs, nowMs: now, formatTime })
  const steady = statusView({ trip: { ...trip, etaMin: null }, lang, receivedAtMs, nowMs: now, formatTime })
  // Announced to screen readers only when the phase or the live/stale state changes: never on every poll or every second.
  const announce = view.stale ? `${steady.text}. ${t(lang, 'status.staleAnnounce')}` : steady.text
  const sentence = headline(trip, lang)
  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className={`inline-flex items-center gap-2 rounded-full py-2 pl-3 pr-4 text-[14px] font-semibold leading-none transition-colors duration-300 ${TONE[steady.tone].chip}`}>
          <StateMark tone={view.tone} phase={trip.phase} stale={view.stale} />
          {steady.text}
        </span>
        <LanguageSwitcher lang={lang} onChange={onLang} />
      </div>

      <h1 className="mt-4 text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-text-primary tabular-nums" style={{ fontFamily: DISPLAY_FONT }}>{view.eta ?? sentence}</h1>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[16px] leading-snug">
        {view.eta && <span className="font-medium text-text-secondary">{sentence}</span>}
        {view.freshness && <span className="text-[13px] font-medium tabular-nums text-text-muted">{view.freshness}</span>}
      </p>
    </>
  )
}

/** A block that folds to nothing and back without jumping the layout (the grid-row trick animates height without measuring it). */
function Fold({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  return (
    <div id={id} inert={!open} className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/** From, any stops and To as one vertical line: a teal dot where it started, a dark square where it ends. */
function Route({ trip, lang, pendingStops }: { trip: PublicTrip; lang: Lang; pendingStops: PublicTrip['stops'] }) {
  const rows: { key: string; label: string; text: string; marker: 'from' | 'stop' | 'to' }[] = [
    { key: 'from', label: t(lang, 'label.from'), text: trip.pickup.label ?? '—', marker: 'from' },
    ...pendingStops.map((s, i) => ({ key: `s${i}`, label: t(lang, 'label.stops'), text: s.label ?? '—', marker: 'stop' as const })),
    ...(trip.drop ? [{ key: 'to', label: t(lang, 'label.to'), text: trip.drop.label ?? '—', marker: 'to' as const }] : []),
  ]
  const marker = { from: 'h-3 w-3 rounded-full bg-primary ring-4 ring-primary-subtle', stop: 'h-2.5 w-2.5 rounded-full border-2 border-primary bg-white', to: 'h-3 w-3 rounded-[3px] bg-text-primary ring-4 ring-border' }
  return (
    <ol className="mt-5">
      {rows.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[20px_1fr] gap-x-3">
          <div className="flex flex-col items-center">
            <span aria-hidden className={`mt-[6px] flex-shrink-0 ${marker[r.marker]}`} />
            {i < rows.length - 1 && <span aria-hidden className="my-1.5 w-0 flex-1 border-l-2 border-dotted border-primary-light" />}
          </div>
          <div className={i < rows.length - 1 ? 'pb-3' : ''}>
            <p className="text-[13px] font-medium leading-none text-text-muted">{r.label}</p>
            <p className="mt-1 line-clamp-2 text-[16px] font-medium leading-snug text-text-primary">{r.text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function LiveTrip({ trip, lang, receivedAtMs, offline, onLang }: { trip: PublicTrip; lang: Lang; receivedAtMs: number; offline: boolean; onLang: (l: Lang) => void }) {
  const sheetRef = useRef<HTMLElement | null>(null)
  const [sheetH, setSheetH] = useState(280)
  // Tall phones open with everything; short ones open folded so the map and the destination stay in view. One tap on the handle flips it.
  const [open, setOpen] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia('(min-height: 760px)').matches))
  const foldId = useId()
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
  // A cancelled trip has no car to look for: the plate and driver would only be noise.
  const showCar = trip.phase !== 'cancelled'
  const hasDriverRow = showCar && Boolean(vehicle || trip.driverFirstName)

  return (
    <>
      <div className="absolute inset-0">
        <TripMap trip={trip} lang={lang} bottomPad={sheetH} label={mapLabel(lang, km)} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto flex max-w-[430px] flex-col gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {offline && <Reconnecting lang={lang} />}
        {trip.isSos && <SosBanner trip={trip} lang={lang} />}
      </div>

      <section
        ref={sheetRef}
        className="absolute bottom-0 z-10 max-h-[70dvh] w-full overflow-y-auto overscroll-contain rounded-t-[32px] bg-surface px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-sheet motion-safe:animate-sheet-in md:left-1/2 md:max-w-[430px] md:-translate-x-1/2"
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={foldId}
          aria-label={t(lang, open ? 'sheet.collapse' : 'sheet.expand')}
          className={`group mx-auto flex h-11 w-24 items-center justify-center rounded-full ${FOCUS}`}
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-primary/25 transition-colors group-active:bg-primary/50" />
        </button>

        <StatusRegion trip={trip} lang={lang} onLang={onLang} receivedAtMs={receivedAtMs} formatTime={formatTime} />

        {showCar && trip.vehicle.plate && <div className="mt-4 flex justify-center"><TripPlate plate={trip.vehicle.plate} /></div>}

        <Fold open={open} id={foldId}>
          {hasDriverRow && (
            <div className="flex items-center gap-3 pt-4">
              <span aria-hidden className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-dark"><User size={20} /></span>
              <div className="min-w-0">
                {trip.driverFirstName && <p className="truncate text-[17px] font-semibold leading-tight text-text-primary"><span className="sr-only">{t(lang, 'label.driver')}: </span>{trip.driverFirstName}</p>}
                {vehicle && <p className="mt-0.5 text-[15px] font-medium leading-snug text-text-secondary">{vehicle}</p>}
              </div>
            </div>
          )}
        </Fold>

        <Route trip={trip} lang={lang} pendingStops={pendingStops} />

        <Fold open={open} id={`${foldId}-note`}>
          <p className="pt-5 text-[13px] font-medium text-text-muted">{t(lang, 'footer.shared')}</p>
        </Fold>
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
