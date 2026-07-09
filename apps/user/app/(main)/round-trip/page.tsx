'use client'

import { Suspense, useState } from 'react'
import { ArrowLeft, RotateCcw, ArrowRight, CreditCard, MapPin } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import OcarSpinner from '@/components/ui/OcarSpinner'
import PickupTimeChip from '@/components/ui/PickupTimeChip'

const EASE = [0.22, 1, 0.36, 1] as const
const HOUR_OPTIONS = [4, 6, 8, 10, 12] as const

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

  const [selectedHours, setSelectedHours] = useState<number | null>(null)
  const [scheduledFor, setScheduledFor] = useState<Date | null>(() => {
    const raw = sp.get('scheduledFor')
    return raw ? new Date(raw) : null
  })
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false)

  const canProceed = hasDestination && selectedHours !== null

  function goToSearch() {
    const params = new URLSearchParams({
      originLat:     String(originLat),
      originLng:     String(originLng),
      originAddress,
      rideType:      'round_trip',
      backTo:        'round_trip',
    })
    if (scheduledFor) params.set('scheduledFor', scheduledFor.toISOString())
    router.push(`/search?${params.toString()}`)
  }

  function handleProceed() {
    if (!hasDestination || selectedHours === null || distanceKm === null || durationMin === null) return
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
      tripHours:          String(selectedHours),
    })
    if (polyline) params.set('polyline', polyline)
    if (scheduledFor) params.set('scheduledFor', scheduledFor.toISOString())
    router.push(`/select-ride?${params.toString()}`)
  }

  const buttonLabel = !hasDestination
    ? 'Set a destination first'
    : selectedHours === null
    ? 'Choose how many hours'
    : scheduledFor
    ? `Schedule your cab · ${selectedHours}h round trip`
    : `Choose your cab · ${selectedHours}h round trip`

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: '#F5F7FF' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 bg-white"
        style={{
          paddingTop:    'max(env(safe-area-inset-top), 16px)',
          paddingBottom: 14,
          borderBottom:  '1px solid #E8EEFF',
        }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 transition-opacity active:opacity-60"
          style={{ background: '#EEF2FF' }}
        >
          <ArrowLeft size={17} strokeWidth={2} style={{ color: '#4F46E5' }} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold leading-tight" style={{ color: '#0F172A', letterSpacing: '-0.01em' }}>
            Round Trip
          </p>
          <p className="text-[11px] font-medium mt-0.5" style={{ color: '#94A3B8' }}>
            Driver stays and brings you back
          </p>
        </div>
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: '#EEF2FF' }}
        >
          <RotateCcw size={16} strokeWidth={2} style={{ color: '#4F46E5' }} />
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="px-4 pt-5 pb-6 space-y-4">

          {/* Route card */}
          <motion.div {...fadeUp(0)}>
            <div
              className="rounded-2xl overflow-hidden bg-white"
              style={{ border: '1px solid #E8EEFF', boxShadow: '0 2px 16px rgba(79,70,229,0.07)' }}
            >
              {/* From — read-only */}
              <div
                className="flex items-center gap-3 px-4 py-3.5"
                style={{ borderBottom: '1px solid #E8EEFF' }}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#94A3B8' }}>From</p>
                  <p className="text-[13px] font-semibold truncate mt-0.5" style={{ color: '#0F172A' }}>{originAddress}</p>
                </div>
                <MapPin size={13} style={{ color: '#C7D2FE' }} className="flex-shrink-0" />
              </div>

              {/* To — tappable */}
              <button
                onClick={goToSearch}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-opacity active:opacity-60"
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors"
                  style={{ background: hasDestination ? '#4F46E5' : '#CBD5E1' }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#94A3B8' }}>To</p>
                  {hasDestination ? (
                    <p className="text-[13px] font-semibold truncate mt-0.5" style={{ color: '#0F172A' }}>{destAddress}</p>
                  ) : (
                    <p className="text-[13px] mt-0.5" style={{ color: '#94A3B8' }}>Where are you going?</p>
                  )}
                </div>
                <ArrowRight size={14} style={{ color: hasDestination ? '#C7D2FE' : '#4F46E5' }} className="flex-shrink-0" />
              </button>
            </div>

            {/* Route meta */}
            {hasDestination && distanceKm !== null && durationMin !== null && (
              <motion.div {...fadeUp(0.05)} className="flex items-center gap-1.5 px-1 mt-2">
                <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>2 × {distanceKm} km = {distanceKm * 2} km total</span>
                <span style={{ color: '#C7D2FE' }}>·</span>
                <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>{Math.round(durationMin)} min</span>
                <span style={{ color: '#C7D2FE' }}>·</span>
                <span className="text-[11px] font-bold" style={{ color: '#4F46E5' }}>both legs covered</span>
              </motion.div>
            )}
          </motion.div>

          {/* Hour selector — shown when destination is set */}
          {hasDestination && (
            <motion.section {...fadeUp(0.06)}>
              <div
                className="rounded-2xl bg-white overflow-hidden px-4 py-4"
                style={{ border: '1px solid #E8EEFF', boxShadow: '0 2px 16px rgba(79,70,229,0.07)' }}
              >
                <p className="text-[12px] font-semibold mb-3" style={{ color: '#475569' }}>
                  How long do you need the driver?
                </p>
                <div className="flex gap-2">
                  {HOUR_OPTIONS.map(h => {
                    const active = selectedHours === h
                    return (
                      <motion.button
                        key={h}
                        onClick={() => setSelectedHours(h)}
                        whileTap={{ scale: 0.93 }}
                        className="flex-1 py-2.5 rounded-xl text-[13px] font-bold transition-all"
                        style={{
                          background: active ? '#4F46E5' : '#EEF2FF',
                          color:      active ? '#FFFFFF' : '#4F46E5',
                          border:     active ? '1.5px solid #4F46E5' : '1.5px solid #C7D2FE',
                        }}
                      >
                        {h}h
                      </motion.button>
                    )
                  })}
                </div>
                <p className="text-[11px] mt-3" style={{ color: '#94A3B8' }}>
                  Minimum 4 hours · Driver stays with you throughout
                </p>
              </div>
            </motion.section>
          )}

          {/* Pickup time — own section, decoupled from the hour selector above */}
          {hasDestination && (
            <motion.section {...fadeUp(0.09)}>
              <PickupTimeChip
                value={scheduledFor}
                pickerOpen={schedulePickerOpen}
                onOpenPicker={() => setSchedulePickerOpen(true)}
                onClosePicker={() => setSchedulePickerOpen(false)}
                onChange={setScheduledFor}
              />
            </motion.section>
          )}

          {/* What's included */}
          <motion.section {...fadeUp(hasDestination ? 0.15 : 0.06)}>
            <div
              className="rounded-2xl px-4 py-4 space-y-2.5"
              style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}
            >
              {[
                'Same driver for both legs — no second booking needed',
                'Fare covers travel, waiting time, and the return',
                'Minimum booking duration is 4 hours',
                'If you end early at a different location, return distance to pickup is added to your fare',
              ].map(text => (
                <div key={text} className="flex items-start gap-2.5">
                  <div
                    className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: '#4F46E5' }}
                  />
                  <p className="text-[12px] font-medium leading-relaxed" style={{ color: '#4338CA' }}>{text}</p>
                </div>
              ))}
            </div>
          </motion.section>

        </div>
      </div>

      {/* ── Book bar ────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 bg-white px-4 pt-3"
        style={{ borderTop: '1px solid #E8EEFF', paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
      >
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: '#F5F7FF', border: '1px solid #E8EEFF' }}
            >
              <CreditCard size={14} style={{ color: '#475569' }} />
            </div>
            <span className="text-sm font-semibold" style={{ color: '#475569' }}>Cash</span>
          </div>
          <button className="text-xs font-bold" style={{ color: '#4F46E5' }}>Change</button>
        </div>

        <button
          onClick={handleProceed}
          disabled={!canProceed}
          className="w-full py-4 rounded-full text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
            boxShadow: canProceed ? '0 4px 20px rgba(79,70,229,0.40)' : 'none',
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
