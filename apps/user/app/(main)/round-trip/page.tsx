'use client'

import { Suspense, useState, useMemo } from 'react'
import { ArrowLeft, RotateCcw, CalendarClock, ArrowRight, Info, CreditCard, MapPin } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { clampTripHours, minReturnDatetimeLocal, toDatetimeLocal } from '@/lib/utils'
import OcarSpinner from '@/components/ui/OcarSpinner'

const EASE = [0.22, 1, 0.36, 1] as const

const fadeUp = (delay = 0) => ({
  initial:    { opacity: 0, y: 10 },
  animate:    { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: EASE, delay },
})

function RoundTripContent() {
  const router = useRouter()
  const sp     = useSearchParams()

  const originLat     = parseFloat(sp.get('originLat')  ?? '20.2961')
  const originLng     = parseFloat(sp.get('originLng')  ?? '85.8245')
  const originAddress = sp.get('originAddress') ?? 'Pickup location'
  const originCityId  = parseInt(sp.get('originCityId') ?? '1', 10)

  // Set only after destination is picked via the search page
  const destLat     = sp.get('destinationLat')     ? parseFloat(sp.get('destinationLat')!)  : null
  const destLng     = sp.get('destinationLng')     ? parseFloat(sp.get('destinationLng')!)  : null
  const destAddress = sp.get('destinationAddress') ?? null
  const distanceKm  = sp.get('distanceKm')  ? parseFloat(sp.get('distanceKm')!)  : null
  const durationMin = sp.get('durationMin') ? parseFloat(sp.get('durationMin')!)  : null
  const polyline    = sp.get('polyline') ?? undefined

  const hasDestination = destLat !== null && destLng !== null && destAddress !== null

  const [returnAt, setReturnAt] = useState<Date | null>(null)

  const tripHours = useMemo(() => clampTripHours(returnAt), [returnAt])

  const canProceed = hasDestination && returnAt !== null

  function goToSearch() {
    const params = new URLSearchParams({
      originLat:     String(originLat),
      originLng:     String(originLng),
      originAddress,
      rideType:      'round_trip',
      backTo:        'round_trip',
    })
    router.push(`/search?${params.toString()}`)
  }

  function handleProceed() {
    if (!hasDestination || returnAt === null || distanceKm === null || durationMin === null) return
    const params = new URLSearchParams({
      originLat:          String(originLat),
      originLng:          String(originLng),
      originAddress,
      destinationLat:     String(destLat),
      destinationLng:     String(destLng),
      destinationAddress: destAddress!,
      distanceKm:         String(distanceKm),
      durationMin:        String(durationMin),
      originCityId:       String(originCityId),
      rideType:           'round_trip',
      returnAt:           returnAt.toISOString(),
    })
    if (polyline) params.set('polyline', polyline)
    router.push(`/select-ride?${params.toString()}`)
  }

  const buttonLabel = !hasDestination
    ? 'Set a destination first'
    : !returnAt
    ? 'Set return date & time'
    : tripHours !== undefined
    ? `Choose your cab · ${tripHours}h round trip`
    : 'Choose your cab'

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 border-b border-slate-100"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)', paddingBottom: 12 }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center flex-shrink-0 active:bg-slate-200 transition-colors"
        >
          <ArrowLeft size={17} strokeWidth={2} className="text-slate-800" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-slate-900 leading-tight">Round Trip</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Same cab, there &amp; back</p>
        </div>
        <div className="w-10 h-10 rounded-2xl bg-violet-50 flex items-center justify-center flex-shrink-0">
          <RotateCcw size={16} strokeWidth={2} className="text-violet-600" />
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="px-4 pt-5 pb-6 space-y-5">

          {/* Route section */}
          <motion.section {...fadeUp(0)}>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Route</p>
            <div className="rounded-2xl border border-slate-100 overflow-hidden bg-slate-50">

              {/* From — read-only */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">From</p>
                  <p className="text-[13px] font-semibold text-slate-800 truncate mt-0.5">{originAddress}</p>
                </div>
                <MapPin size={13} className="text-slate-300 flex-shrink-0" />
              </div>

              {/* To — tappable */}
              <button
                onClick={goToSearch}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-100 transition-colors"
              >
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors ${hasDestination ? 'bg-violet-500' : 'bg-slate-300'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">To</p>
                  {hasDestination ? (
                    <p className="text-[13px] font-semibold text-slate-800 truncate mt-0.5">{destAddress}</p>
                  ) : (
                    <p className="text-[13px] text-slate-400 mt-0.5">Where are you going?</p>
                  )}
                </div>
                <ArrowRight size={14} className={hasDestination ? 'text-slate-300' : 'text-violet-500'} />
              </button>
            </div>

            {/* Route meta pill */}
            {hasDestination && distanceKm !== null && durationMin !== null && (
              <motion.div
                {...fadeUp(0.05)}
                className="flex items-center justify-center gap-2 mt-2.5"
              >
                <span className="text-[11px] text-slate-400 font-medium">{distanceKm} km</span>
                <span className="text-slate-200">·</span>
                <span className="text-[11px] text-slate-400 font-medium">{Math.round(durationMin)} min one way</span>
                <span className="text-slate-200">·</span>
                <span className="text-[11px] font-bold text-violet-500">Round trip</span>
              </motion.div>
            )}
          </motion.section>

          {/* Return date — shown only when destination is set */}
          {hasDestination && (
            <motion.section {...fadeUp(0.06)}>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
                Return date &amp; time
              </p>
              <label className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 cursor-pointer focus-within:border-violet-400 focus-within:ring-1 focus-within:ring-violet-200 transition-all">
                <CalendarClock size={15} className="text-violet-500 flex-shrink-0" />
                <input
                  type="datetime-local"
                  min={minReturnDatetimeLocal()}
                  value={returnAt ? toDatetimeLocal(returnAt) : ''}
                  onChange={e => setReturnAt(e.target.value ? new Date(e.target.value) : null)}
                  className="flex-1 bg-transparent text-[13px] font-semibold text-slate-900 outline-none"
                />
              </label>

              {tripHours !== undefined && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="mt-2 flex items-center justify-between px-4 py-3 rounded-2xl bg-violet-50 border border-violet-100"
                >
                  <span className="text-[12px] font-semibold text-violet-700">Approx trip duration</span>
                  <span className="text-[17px] font-black text-violet-700 tabular-nums">{tripHours}h</span>
                </motion.div>
              )}
            </motion.section>
          )}

          {/* Info card */}
          <motion.section {...fadeUp(hasDestination ? 0.12 : 0.06)}>
            <div className="flex items-start gap-3 bg-slate-50 rounded-2xl px-4 py-4 border border-slate-100">
              <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
              <p className="text-[12px] text-slate-500 leading-relaxed">
                Your driver waits and brings you back. Fare covers both legs plus driver waiting time. Minimum 4 hours.
              </p>
            </div>
          </motion.section>

        </div>
      </div>

      {/* ── Book bar ────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 bg-white border-t border-slate-100 px-4 pt-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
      >
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
              <CreditCard size={14} className="text-slate-600" />
            </div>
            <span className="text-sm font-semibold text-slate-700">Cash</span>
          </div>
          <button className="text-xs font-bold text-violet-600">Change</button>
        </div>

        <button
          onClick={handleProceed}
          disabled={!canProceed}
          className="w-full py-4 rounded-2xl text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
            minHeight: 52,
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  )
}

export default function RoundTripPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center bg-white">
        <OcarSpinner size={32} variant="mono" />
      </div>
    }>
      <RoundTripContent />
    </Suspense>
  )
}
