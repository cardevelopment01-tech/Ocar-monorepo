'use client'

import { Suspense, useState, useEffect } from 'react'
import { ArrowLeft, RotateCcw, CreditCard } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import OcarSpinner from '@/components/ui/OcarSpinner'
import PickupTimeChip from '@/components/ui/PickupTimeChip'
import RouteTimeline, { type TimelineNode } from '@/components/route/RouteTimeline'
import AddStopSheet from '@/components/route/AddStopSheet'
import { swapAt } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as const
const HOUR_OPTIONS = [4, 6, 8, 10, 12] as const
const MAX_STOPS = 3

const fadeUp = (delay = 0) => ({
  initial:    { opacity: 0, y: 10 },
  animate:    { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: EASE, delay },
})

type Stop = { address: string; lat: number; lng: number }

function parseStops(sp: URLSearchParams): Stop[] {
  const out: Stop[] = []
  for (let i = 0; i < MAX_STOPS; i++) {
    const lat     = sp.get(`stops[${i}][lat]`)
    const lng     = sp.get(`stops[${i}][lng]`)
    const address = sp.get(`stops[${i}][address]`)
    if (lat && lng && address !== null) out.push({ lat: parseFloat(lat), lng: parseFloat(lng), address })
  }
  return out
}

function RoundTripContent() {
  const router = useRouter()
  const sp     = useSearchParams()

  const originLat     = parseFloat(sp.get('originLat')  ?? '')
  const originLng     = parseFloat(sp.get('originLng')  ?? '')
  const originAddress = sp.get('originAddress') ?? 'Pickup location'
  const hasOrigin     = !isNaN(originLat) && !isNaN(originLng)
  const originCityId  = parseInt(sp.get('originCityId') ?? '1', 10)

  // Set only after destination is picked via the search page
  const destLat     = sp.get('destinationLat')     ? parseFloat(sp.get('destinationLat')!)  : null
  const destLng     = sp.get('destinationLng')     ? parseFloat(sp.get('destinationLng')!)  : null
  const destAddress = sp.get('destinationAddress') ?? null
  const distanceKm  = sp.get('distanceKm')  ? parseFloat(sp.get('distanceKm')!)  : null
  const durationMin = sp.get('durationMin') ? parseFloat(sp.get('durationMin')!)  : null
  const polyline    = sp.get('polyline') ?? undefined
  const riderName   = sp.get('riderName') ?? undefined
  const riderPhone  = sp.get('riderPhone') ?? undefined

  const hasDestination = destLat !== null && destLng !== null && destAddress !== null
  const stops = parseStops(sp)

  const [selectedHours, setSelectedHours] = useState<number | null>(null)
  const [paymentNote, setPaymentNote] = useState<string | null>(null)
  const [scheduledFor, setScheduledFor] = useState<Date | null>(() => {
    const raw = sp.get('scheduledFor')
    return raw ? new Date(raw) : null
  })
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false)
  const [addStopOpen, setAddStopOpen] = useState(false)

  const canProceed = hasDestination && selectedHours !== null

  useEffect(() => {
    if (!hasOrigin) router.replace('/home')
  }, [hasOrigin, router])

  // Carries origin/destination/schedule/stops forward through the /search bounce —
  // same preservation discipline as the pre-existing goToSearch().
  function buildCarriedParams(stopsOverride?: Stop[]) {
    const params = new URLSearchParams({
      originLat:     String(originLat),
      originLng:     String(originLng),
      originAddress,
      rideType:      'round_trip',
    })
    if (hasDestination) {
      params.set('destinationLat', String(destLat))
      params.set('destinationLng', String(destLng))
      params.set('destinationAddress', destAddress!)
    }
    if (distanceKm !== null)  params.set('distanceKm', String(distanceKm))
    if (durationMin !== null) params.set('durationMin', String(durationMin))
    if (polyline) params.set('polyline', polyline)
    if (scheduledFor) params.set('scheduledFor', scheduledFor.toISOString())
    if (riderName)  params.set('riderName', riderName)
    if (riderPhone) params.set('riderPhone', riderPhone)
    ;(stopsOverride ?? stops).forEach((s, i) => {
      params.set(`stops[${i}][address]`, s.address)
      params.set(`stops[${i}][lat]`, String(s.lat))
      params.set(`stops[${i}][lng]`, String(s.lng))
    })
    return params
  }

  function goToSearch() {
    const params = buildCarriedParams()
    params.set('backTo', 'round_trip')
    router.push(`/search?${params.toString()}`)
  }

  function removeStop(index: number) {
    const nextStops = stops.filter((_, i) => i !== index)
    const params = buildCarriedParams(nextStops)
    router.replace(`/round-trip?${params.toString()}`)
  }

  function swapStops(index: number) {
    router.replace(`/round-trip?${buildCarriedParams(swapAt(stops, index)).toString()}`)
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
    if (riderName)  params.set('riderName', riderName)
    if (riderPhone) params.set('riderPhone', riderPhone)
    stops.forEach((s, i) => {
      params.set(`stops[${i}][address]`, s.address)
      params.set(`stops[${i}][lat]`, String(s.lat))
      params.set(`stops[${i}][lng]`, String(s.lng))
    })
    router.push(`/select-ride?${params.toString()}`)
  }

  const buttonLabel = !hasDestination
    ? 'Set a destination first'
    : selectedHours === null
    ? 'Choose how many hours'
    : scheduledFor
    ? `Schedule your cab · ${selectedHours}h round trip`
    : `Choose your cab · ${selectedHours}h round trip`

  const timelineNodes: TimelineNode[] = [{ kind: 'origin', address: originAddress }]
  if (hasDestination) {
    stops.forEach((s, i) => timelineNodes.push({
      kind: 'stop',
      key: `${s.lat}-${s.lng}`,
      address: s.address,
      onRemove: () => removeStop(i),
      ...(i < stops.length - 1 ? { onSwap: () => swapStops(i) } : {}),
    }))
    if (stops.length < MAX_STOPS) timelineNodes.push({ kind: 'add', onTap: () => setAddStopOpen(true) })
  }
  timelineNodes.push({ kind: 'destination', address: destAddress, placeholder: 'Where are you going?', onTap: goToSearch })

  if (!hasOrigin) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <OcarSpinner size={32} variant="mono" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative" style={{ background: '#F5F7FF' }}>

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
          style={{ background: '#E4F8FA' }}
        >
          <ArrowLeft size={17} strokeWidth={2} style={{ color: '#0A9FB0' }} />
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
          style={{ background: '#E4F8FA' }}
        >
          <RotateCcw size={16} strokeWidth={2} style={{ color: '#0A9FB0' }} />
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
            <RouteTimeline nodes={timelineNodes} className="shadow-[0_2px_16px_rgba(10, 159, 176,0.07)]" />

            {/* Route meta */}
            {hasDestination && distanceKm !== null && durationMin !== null && (
              <motion.div {...fadeUp(0.05)} className="flex items-center gap-1.5 px-1 mt-2 flex-wrap">
                <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>2 × {distanceKm} km = {distanceKm * 2} km total</span>
                <span style={{ color: '#B8E9EE' }}>·</span>
                <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>{Math.round(durationMin)} min</span>
                <span style={{ color: '#B8E9EE' }}>·</span>
                <span className="text-[11px] font-bold" style={{ color: '#0A9FB0' }}>both legs covered</span>
                {stops.length > 0 && (
                  <>
                    <span style={{ color: '#B8E9EE' }}>·</span>
                    <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                      {stops.length} {stops.length === 1 ? 'stop' : 'stops'}
                    </span>
                  </>
                )}
              </motion.div>
            )}
            {stops.length > 0 && (
              <motion.p {...fadeUp(0.06)} className="text-[11px] font-medium px-1 mt-1.5" style={{ color: '#94A3B8' }}>
                Stops are visited in this order
              </motion.p>
            )}
          </motion.div>

          {/* Hour selector, shown when destination is set */}
          {hasDestination && (
            <motion.section {...fadeUp(0.06)}>
              <div
                className="rounded-2xl bg-white overflow-hidden px-4 py-4"
                style={{ border: '1px solid #E8EEFF', boxShadow: '0 2px 16px rgba(10, 159, 176,0.07)' }}
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
                          background: active ? '#0A9FB0' : '#E4F8FA',
                          color:      active ? '#FFFFFF' : '#0A9FB0',
                          border:     active ? '1.5px solid #0A9FB0' : '1.5px solid #B8E9EE',
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

          {/* Pickup time, own section, decoupled from the hour selector above */}
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
              style={{ background: '#E4F8FA', border: '1px solid #B8E9EE' }}
            >
              {[
                'Same driver for both legs, no second booking needed',
                'Fare covers travel, waiting time, and the return',
                'Minimum booking duration is 4 hours',
                'If you end early at a different location, return distance to pickup is added to your fare',
              ].map(text => (
                <div key={text} className="flex items-start gap-2.5">
                  <div
                    className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: '#0A9FB0' }}
                  />
                  <p className="text-[12px] font-medium leading-relaxed" style={{ color: '#087C89' }}>{text}</p>
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
          <button
            className="text-xs font-bold"
            style={{ color: '#0A9FB0' }}
            onClick={() => { setPaymentNote('Cash only for now'); setTimeout(() => setPaymentNote(null), 2000) }}
          >
            Change
          </button>
        </div>
        {paymentNote && <p className="text-slate-500 text-xs text-center mb-2">{paymentNote}</p>}

        <button
          onClick={handleProceed}
          disabled={!canProceed}
          className="w-full py-4 rounded-full text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #0A9FB0 0%, #DC3E93 100%)',
            boxShadow: canProceed ? '0 4px 20px rgba(10, 159, 176,0.40)' : 'none',
            minHeight: 52,
          }}
        >
          {buttonLabel}
        </button>
      </div>

      <AddStopSheet
        open={addStopOpen}
        onClose={() => setAddStopOpen(false)}
        onSelect={(s) => { setAddStopOpen(false); router.replace(`/round-trip?${buildCarriedParams([...stops, s]).toString()}`) }}
        title={`Add stop ${stops.length + 1}`}
        originLat={originLat}
        originLng={originLng}
      />
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
