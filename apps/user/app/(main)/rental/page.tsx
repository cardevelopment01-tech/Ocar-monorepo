'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft, MapPin, Clock,
  CreditCard, Zap, Users, Navigation, Plus, X,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { rideApi, type RentalPackage, type FareEstimate, type StopInput } from '@/lib/ride-api'
import { VehicleIcon } from '@/components/ui/VehicleIcon'
import AnimatedNumber from '@/components/ui/AnimatedNumber'
import OcarSpinner from '@/components/ui/OcarSpinner'
import PickupTimeChip from '@/components/ui/PickupTimeChip'

// ─── constants ────────────────────────────────────────────────────────────────

type Category = { id: number; slug: string; display_name: string; max_passengers: number }

const CATEGORIES: Category[] = [
  { id: 1, slug: 'hatchback', display_name: 'Hatchback', max_passengers: 4 },
  { id: 2, slug: 'sedan',     display_name: 'Sedan',     max_passengers: 4 },
  { id: 3, slug: 'suv',       display_name: 'SUV',       max_passengers: 6 },
  { id: 4, slug: 'luxury',    display_name: 'Luxury',    max_passengers: 4 },
  { id: 5, slug: 'van',       display_name: 'Van',        max_passengers: 8 },
]

const EASE = [0.22, 1, 0.36, 1] as const

const fadeUp = (delay = 0) => ({
  initial:    { opacity: 0, y: 10 },
  animate:    { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: EASE, delay },
})

const MAX_STOPS = 3

function parseStops(sp: URLSearchParams): StopInput[] {
  const out: StopInput[] = []
  for (let i = 0; i < MAX_STOPS; i++) {
    const lat     = sp.get(`stops[${i}][lat]`)
    const lng     = sp.get(`stops[${i}][lng]`)
    const address = sp.get(`stops[${i}][address]`)
    if (lat && lng && address !== null) out.push({ lat: parseFloat(lat), lng: parseFloat(lng), address })
  }
  return out
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** pg returns NUMERIC as string, coerce safely for display */
function num(v: number): number {
  return parseFloat(String(v))
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} hr${h > 1 ? 's' : ''}` : `${h}h ${m}m`
}

// ─── component ────────────────────────────────────────────────────────────────

function RentalContent() {
  const router = useRouter()
  const sp     = useSearchParams()

  const originLat     = parseFloat(sp.get('originLat')  ?? '20.2961')
  const originLng     = parseFloat(sp.get('originLng')  ?? '85.8245')
  const originAddress = sp.get('originAddress') ?? 'Pickup location'
  const originCityId  = parseInt(sp.get('originCityId') ?? '1', 10)

  const destAddress = sp.get('destinationAddress') ?? null
  const hasDestination = destAddress !== null
  const destLat = sp.get('destinationLat')
  const destLng = sp.get('destinationLng')
  const stops = parseStops(sp)

  const [scheduledFor,        setScheduledFor]        = useState<Date | null>(() => {
    const raw = sp.get('scheduledFor')
    return raw ? new Date(raw) : null
  })
  const [schedulePickerOpen,  setSchedulePickerOpen]  = useState(false)

  // Carries origin/destination/schedule/stops forward through the /search bounce
  function buildCarriedParams(stopsOverride?: StopInput[]) {
    const params = new URLSearchParams({
      originLat: String(originLat),
      originLng: String(originLng),
      originAddress,
      backTo:    'rental',
    })
    if (hasDestination && destLat && destLng) {
      params.set('destinationLat', destLat)
      params.set('destinationLng', destLng)
      params.set('destinationAddress', destAddress!)
    }
    if (scheduledFor) params.set('scheduledFor', scheduledFor.toISOString())
    ;(stopsOverride ?? stops).forEach((s, i) => {
      params.set(`stops[${i}][address]`, s.address)
      params.set(`stops[${i}][lat]`, String(s.lat))
      params.set(`stops[${i}][lng]`, String(s.lng))
    })
    return params
  }

  function addDestination() {
    const params = buildCarriedParams()
    // Don't carry the stale destination forward — search's auto-navigate effect
    // fires as soon as both origin+destination are present and would bounce
    // straight back to /rental before the user can type a new one.
    params.delete('destinationLat')
    params.delete('destinationLng')
    params.delete('destinationAddress')
    params.set('focus', 'destination')
    router.push(`/search?${params.toString()}`)
  }

  function goToAddStop() {
    const params = buildCarriedParams()
    params.set('stopIndex', String(stops.length))
    router.push(`/search?${params.toString()}`)
  }

  function removeStop(index: number) {
    const nextStops = stops.filter((_, i) => i !== index)
    router.replace(`/rental?${buildCarriedParams(nextStops).toString()}`)
  }

  const [selectedCatId,   setSelectedCatId]  = useState<number>(CATEGORIES[1]!.id)
  const [packages,        setPackages]        = useState<RentalPackage[]>([])
  const [pkgsLoading,     setPkgsLoading]     = useState(true)
  const [selectedPkgId,   setSelectedPkgId]  = useState<number | null>(null)
  const [estimate,        setEstimate]        = useState<FareEstimate | null>(null)
  const [estLoading,      setEstLoading]      = useState(false)
  const [isBooking,       setIsBooking]       = useState(false)
  const [bookError,       setBookError]       = useState<string | null>(null)

  // Fetch packages whenever category changes; auto-select first
  const loadPackages = useCallback(async (catId: number) => {
    setPkgsLoading(true)
    setPackages([])
    setSelectedPkgId(null)
    setEstimate(null)
    try {
      const pkgs = await rideApi.getRentalPackages(catId)
      setPackages(pkgs)
      if (pkgs[0]) setSelectedPkgId(pkgs[0].id)
    } catch {
      setPackages([])
    } finally {
      setPkgsLoading(false)
    }
  }, [])

  useEffect(() => { void loadPackages(selectedCatId) }, [selectedCatId, loadPackages])

  // Fetch estimate whenever the selected package changes
  const loadEstimate = useCallback(async (pkgId: number, catId: number) => {
    setEstLoading(true)
    setEstimate(null)
    try {
      const est = await rideApi.getEstimate({
        categoryId:      catId,
        rideType:        'rental',
        rentalPackageId: pkgId,
        distanceKm:      0,
        durationMin:     0,
        originCityId,
      })
      setEstimate(est)
    } catch {
      setEstimate(null)
    } finally {
      setEstLoading(false)
    }
  }, [originCityId])

  useEffect(() => {
    if (selectedPkgId !== null) void loadEstimate(selectedPkgId, selectedCatId)
  }, [selectedPkgId, selectedCatId, loadEstimate])

  const selectedCat = CATEGORIES.find(c => c.id === selectedCatId)!
  const selectedPkg = packages.find(p => p.id === selectedPkgId) ?? null
  const canBook     = selectedPkgId !== null && estimate !== null && !estLoading && !isBooking

  async function handleBook() {
    if (selectedPkgId === null || !selectedPkg) return
    setIsBooking(true)
    setBookError(null)
    try {
      const params: Parameters<typeof rideApi.createBooking>[0] = {
        categoryId:      selectedCatId,
        rideType:        'rental',
        originLat,
        originLng,
        originAddress,
        distanceKm:      0,
        durationMin:     0,
        rentalPackageId: selectedPkgId,
      }
      if (originCityId) params.originCityId = originCityId
      if (scheduledFor) params.scheduledFor = scheduledFor.toISOString()
      if (stops.length > 0) params.stops = stops
      if (hasDestination && destLat && destLng) {
        params.destinationLat = parseFloat(destLat)
        params.destinationLng = parseFloat(destLng)
        params.destinationAddress = destAddress!
      }
      const result = await rideApi.createBooking(params)
      router.push(scheduledFor ? '/history?scheduled=1' : `/ride/${result.rideId}`)
    } catch {
      setBookError('Booking failed. Please try again.')
      setIsBooking(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────── */}
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
          <p className="text-[15px] font-bold text-slate-900 leading-tight">City Rides</p>
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin size={10} strokeWidth={2.5} className="text-violet-500 flex-shrink-0" />
            <p className="text-[11px] text-slate-400 truncate">{originAddress}</p>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="px-4 pt-5 pb-6 space-y-6">

          {/* Pickup time, own section, above vehicle/package selection */}
          <motion.section {...fadeUp(0)}>
            <PickupTimeChip
              value={scheduledFor}
              pickerOpen={schedulePickerOpen}
              onOpenPicker={() => setSchedulePickerOpen(true)}
              onClosePicker={() => setSchedulePickerOpen(false)}
              onChange={setScheduledFor}
            />
          </motion.section>

          {/* Drop-off (optional) */}
          <motion.section {...fadeUp(0)}>
            {hasDestination ? (
              <motion.button
                key="dest-chip"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={addDestination}
                className="w-full flex items-center gap-2.5 rounded-2xl px-4 py-3 text-left"
                style={{ background: '#F1F0FE', border: '1px solid #DDD9FB' }}
              >
                <Navigation size={13} strokeWidth={2.2} className="text-violet-600 flex-shrink-0" />
                <span className="flex-1 min-w-0 text-[12px] font-semibold text-violet-700 truncate">{destAddress}</span>
                <span className="text-[10px] font-bold text-violet-500 flex-shrink-0">Change</span>
              </motion.button>
            ) : (
              <button
                onClick={addDestination}
                className="w-full flex items-center gap-2.5 rounded-2xl px-4 py-3 text-left transition-colors active:bg-slate-50"
                style={{ border: '1.5px dashed #CBD5E1' }}
              >
                <Navigation size={13} strokeWidth={2.2} className="text-slate-400 flex-shrink-0" />
                <span className="flex-1 text-[12px] font-medium text-slate-400">Add a drop-off (optional)</span>
              </button>
            )}
          </motion.section>

          {/* Plan your stops — free itinerary, never touches fare (§2.2 of the plan) */}
          <motion.section {...fadeUp(0)}>
            <div className="rounded-2xl overflow-hidden bg-white" style={{ border: '1px solid #E8EEFF' }}>
              <div className="px-4 pt-3.5 pb-1">
                <p className="text-[12px] font-bold" style={{ color: '#0F172A' }}>Plan your stops · optional</p>
                <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
                  Tell your driver where you plan to go — you can always change your mind during the ride
                </p>
              </div>

              <AnimatePresence initial={false}>
                {stops.map((stop, i) => (
                  <motion.div
                    key={`${stop.lat}-${stop.lng}-${i}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="flex items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid #E8EEFF' }}>
                      <div className="w-2.5 h-2.5 flex-shrink-0" style={{ background: '#7C3AED', borderRadius: 3 }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#94A3B8' }}>
                          Stop {i + 1}
                        </p>
                        <p className="text-[13px] font-semibold truncate mt-0.5" style={{ color: '#0F172A' }}>
                          {stop.address}
                        </p>
                      </div>
                      <motion.button
                        onClick={() => removeStop(i)}
                        aria-label={`Remove stop ${i + 1}`}
                        whileTap={{ scale: 0.9 }}
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity active:opacity-60"
                      >
                        <X size={14} strokeWidth={2} style={{ color: '#94A3B8' }} />
                      </motion.button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {stops.length < MAX_STOPS && (
                <motion.button
                  onClick={goToAddStop}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-opacity active:opacity-60"
                  style={{ borderTop: '1px solid #E8EEFF' }}
                >
                  <div
                    className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ border: '1.5px dashed #C7D2FE' }}
                  >
                    <Plus size={12} strokeWidth={2.4} style={{ color: '#4F46E5' }} />
                  </div>
                  <span className="text-[13px] font-semibold" style={{ color: '#4F46E5' }}>Add a stop</span>
                </motion.button>
              )}
            </div>
          </motion.section>

          {/* Vehicle category */}
          <motion.section {...fadeUp(0)}>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
              Vehicle
            </p>
            <div className="grid grid-cols-5 gap-1.5">
              {CATEGORIES.map(cat => {
                const active = cat.id === selectedCatId
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCatId(cat.id)}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2.5 rounded-2xl border transition-all duration-150',
                      active
                        ? 'bg-violet-50 border-violet-300 shadow-sm'
                        : 'bg-slate-50 border-slate-100 active:bg-slate-100'
                    )}
                  >
                    <VehicleIcon slug={cat.slug} size={26} color={active ? '#4F46E5' : '#94A3B8'} />
                    <span className={cn(
                      'text-[10px] font-semibold leading-none',
                      active ? 'text-violet-700' : 'text-slate-500'
                    )}>
                      {cat.display_name}
                    </span>
                    <span className={cn(
                      'flex items-center gap-0.5 text-[9px]',
                      active ? 'text-violet-400' : 'text-slate-400'
                    )}>
                      <Users size={8} strokeWidth={2.5} />
                      {cat.max_passengers}
                    </span>
                  </button>
                )
              })}
            </div>
          </motion.section>

          {/* Package selector */}
          <motion.section {...fadeUp(0.06)}>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
              Package
            </p>

            {pkgsLoading ? (
              <div className="space-y-2">
                {[1, 2].map(i => (
                  <div key={i} className="h-[72px] rounded-2xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : packages.length === 0 ? (
              <div className="h-16 rounded-2xl bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center">
                <p className="text-sm text-slate-400">No packages for this vehicle type</p>
              </div>
            ) : (
              <div className="space-y-2">
                {packages.map(pkg => {
                  const active = pkg.id === selectedPkgId
                  const fare   = num(pkg.package_fare)
                  const xKm    = num(pkg.extra_per_km)
                  const xMin   = num(pkg.extra_per_min)
                  return (
                    <button
                      key={pkg.id}
                      onClick={() => setSelectedPkgId(pkg.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all duration-150 text-left',
                        active
                          ? 'bg-violet-50 border-violet-300 shadow-sm'
                          : 'bg-slate-50 border-slate-100 active:bg-slate-100'
                      )}
                    >
                      {/* Icon */}
                      <div className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                        active ? 'bg-violet-100' : 'bg-white border border-slate-200'
                      )}>
                        <Clock size={16} strokeWidth={2} className={active ? 'text-violet-600' : 'text-slate-400'} />
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'text-[14px] font-bold leading-tight',
                          active ? 'text-violet-900' : 'text-slate-900'
                        )}>
                          {formatDuration(pkg.duration_minutes)} · {pkg.km_limit} km
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Extra ₹{xKm}/km · ₹{xMin}/min beyond limit
                        </p>
                      </div>

                      {/* Price + radio */}
                      <div className="flex-shrink-0 flex items-center gap-2.5">
                        <p className={cn(
                          'text-[17px] font-black tabular-nums',
                          active ? 'text-violet-900' : 'text-slate-900'
                        )}>
                          ₹{Math.round(fare)}
                        </p>
                        <div className={cn(
                          'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-150',
                          active ? 'border-violet-500' : 'border-slate-200'
                        )}>
                          {active && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </motion.section>

          {/* Fare summary, only once a package is selected */}
          {selectedPkg && (
            <motion.section {...fadeUp(0.18)}>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 space-y-3">

                {/* Package header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[12px] font-semibold text-slate-700">
                      {selectedCat.display_name} · {formatDuration(selectedPkg.duration_minutes)} / {selectedPkg.km_limit} km
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Overage charged at end of trip
                    </p>
                  </div>
                  {estimate != null && estimate.surge_multiplier > 1 && (
                    <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-500 flex-shrink-0">
                      <Zap size={9} />{estimate.surge_multiplier}×
                    </span>
                  )}
                </div>

                {/* Breakdown rows */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-slate-500">Package fare</span>
                    <span className="font-semibold text-slate-700">
                      ₹{Math.round(num(selectedPkg.package_fare))}
                    </span>
                  </div>

                  {estimate != null && estimate.breakdown.surge_fare > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-amber-600">Surge ({estimate.surge_multiplier}×)</span>
                      <span className="font-semibold text-amber-600">
                        +₹{Math.round(estimate.breakdown.surge_fare)}
                      </span>
                    </div>
                  )}

                  <div className="h-px bg-slate-200 my-1" />

                  <div className="flex justify-between items-baseline">
                    <span className="text-[13px] font-bold text-slate-900">Total</span>
                    {estLoading ? (
                      <div className="w-16 h-5 bg-slate-200 rounded animate-pulse" />
                    ) : estimate != null ? (
                      <span className="text-[19px] font-black text-violet-700 tabular-nums">
                        ₹<AnimatedNumber value={Math.round(estimate.breakdown.total)} />
                      </span>
                    ) : (
                      <span className="text-slate-400 text-sm">—</span>
                    )}
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </div>
      </div>

      {/* ── Book bar ────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 bg-white border-t border-slate-100 px-4 pt-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
      >
        {/* Payment method */}
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
              <CreditCard size={14} className="text-slate-600" />
            </div>
            <span className="text-sm font-semibold text-slate-700">Cash</span>
          </div>
          <button className="text-xs font-bold text-violet-600">Change</button>
        </div>

        {bookError && (
          <p className="text-red-500 text-sm text-center mb-2">{bookError}</p>
        )}

        <button
          onClick={handleBook}
          disabled={!canBook}
          className="w-full py-4 rounded-2xl text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
            minHeight: 52,
          }}
        >
          {isBooking
            ? 'Booking…'
            : !selectedPkg
            ? 'Select a package'
            : estimate != null
            ? `${scheduledFor ? 'Schedule' : 'Book'} ${selectedCat.display_name} · ₹${Math.round(estimate.breakdown.total)}`
            : `${scheduledFor ? 'Schedule' : 'Book'} ${selectedCat.display_name}`
          }
        </button>
      </div>
    </div>
  )
}

export default function RentalPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center bg-white">
        <OcarSpinner size={32} variant="mono" />
      </div>
    }>
      <RentalContent />
    </Suspense>
  )
}
