'use client'

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ArrowLeft, MapPin, Clock,
  CreditCard, Zap, Users, Navigation, Sparkles, Info,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { cn, swapAt } from '@/lib/utils'
import { isAxiosError } from 'axios'
import { rideApi, type RentalPackage, type FareEstimate, type StopInput } from '@/lib/ride-api'
import { vehicleApi, type VehicleCategory } from '@/lib/vehicle-api'
import { geoApi } from '@/lib/geo-api'
import { recommendPackage } from '@/lib/recommend-package'
import { getPaymentChannel } from '@/lib/payment-channel'
import { VehicleIcon } from '@/components/ui/VehicleIcon'
import AnimatedNumber from '@/components/ui/AnimatedNumber'
import OcarSpinner from '@/components/ui/OcarSpinner'
import PickupTimeChip from '@/components/ui/PickupTimeChip'
import RouteTimeline, { type TimelineNode } from '@/components/route/RouteTimeline'
import AddStopSheet from '@/components/route/AddStopSheet'
import BookingForSheet from '@/components/booking/BookingForSheet'

// ─── constants ────────────────────────────────────────────────────────────────

type Category = VehicleCategory

const FALLBACK_CATEGORIES: Category[] = [
  { id: 1, slug: 'hatchback',    display_name: 'Hatchback',    max_passengers: 4 },
  { id: 2, slug: 'sedan',        display_name: 'Sedan',        max_passengers: 4 },
  { id: 3, slug: 'suv',          display_name: 'SUV',          max_passengers: 6 },
  { id: 4, slug: 'luxury',       display_name: 'Luxury',       max_passengers: 4 },
  { id: 5, slug: 'van',          display_name: 'Van',          max_passengers: 8 },
  { id: 6, slug: 'auto_rickshaw', display_name: 'Auto Rickshaw', max_passengers: 3 },
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

  const originLat     = parseFloat(sp.get('originLat')  ?? '')
  const originLng     = parseFloat(sp.get('originLng')  ?? '')
  const originAddress = sp.get('originAddress') ?? 'Pickup location'
  const hasOrigin     = !isNaN(originLat) && !isNaN(originLng)
  const originCityId  = sp.get('originCityId') ? parseInt(sp.get('originCityId')!, 10) : undefined

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

  const [forMeOpen,  setForMeOpen]  = useState(false)
  const [riderName,  setRiderName]  = useState(() => sp.get('riderName') ?? '')
  const [riderPhone, setRiderPhone] = useState(() => sp.get('riderPhone') ?? '')
  const bookingForOther = riderName !== '' && riderPhone !== ''

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
    if (riderName)  params.set('riderName', riderName)
    if (riderPhone) params.set('riderPhone', riderPhone)
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

  const [addStopOpen, setAddStopOpen] = useState(false)

  function removeStop(index: number) {
    const nextStops = stops.filter((_, i) => i !== index)
    router.replace(`/rental?${buildCarriedParams(nextStops).toString()}`)
  }

  function swapStops(index: number) {
    router.replace(`/rental?${buildCarriedParams(swapAt(stops, index)).toString()}`)
  }

  const rentalStopNodes: TimelineNode[] = stops.map((s, i) => ({
    kind: 'stop' as const,
    key: `${s.lat}-${s.lng}`,
    address: s.address,
    onRemove: () => removeStop(i),
    ...(i < stops.length - 1 ? { onSwap: () => swapStops(i) } : {}),
  }))
  if (stops.length < MAX_STOPS) rentalStopNodes.push({ kind: 'add', onTap: () => setAddStopOpen(true) })

  const [categories,      setCategories]      = useState<Category[]>(FALLBACK_CATEGORIES)
  const [selectedCatId,   setSelectedCatId]  = useState<number>(FALLBACK_CATEGORIES[1]!.id)
  const [packages,        setPackages]        = useState<RentalPackage[]>([])
  const [pkgsLoading,     setPkgsLoading]     = useState(true)
  const [selectedPkgId,   setSelectedPkgId]  = useState<number | null>(null)
  const [estimate,        setEstimate]        = useState<FareEstimate | null>(null)
  const [estLoading,      setEstLoading]      = useState(false)
  const [isBooking,       setIsBooking]       = useState(false)
  const [bookError,       setBookError]       = useState<string | null>(null)
  const [paymentNote,     setPaymentNote]     = useState<string | null>(null)

  // Route pickup → stops → drop (drive distance/time). Non-traffic-aware: package tiers
  // are coarse (hours/tens of km), so live traffic wouldn't change the pick but would
  // double the routing cost per lookup.
  const [trip, setTrip] = useState<{ km: number; min: number } | null>(null)
  // False while the route is in flight, so we don't preselect a package and then
  // immediately flip to the recommended one (fare flicker + wasted estimate call).
  const [tripReady, setTripReady] = useState(false)
  const stopsKey = stops.map(s => `${s.lat},${s.lng}`).join('|')
  useEffect(() => {
    if (!hasOrigin || !destLat || !destLng) { setTrip(null); setTripReady(true); return }
    let cancelled = false
    setTripReady(false)
    const pts: Array<[number, number]> = [
      [originLat, originLng],
      ...stops.map((s): [number, number] => [s.lat, s.lng]),
      [parseFloat(destLat), parseFloat(destLng)],
    ]
    Promise.all(pts.slice(0, -1).map((p, i) => geoApi.getRoute(p[0], p[1], pts[i + 1]![0], pts[i + 1]![1])))
      .then(legs => {
        if (cancelled) return
        setTrip({
          km:  Math.round(legs.reduce((s, l) => s + l.distanceKm, 0) * 10) / 10,
          min: Math.round(legs.reduce((s, l) => s + l.durationMin, 0)),
        })
        setTripReady(true)
      })
      .catch(() => { if (!cancelled) { setTrip(null); setTripReady(true) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOrigin, originLat, originLng, destLat, destLng, stopsKey])

  // Fetch packages whenever category changes; selection follows the recommendation
  // until the rider picks one themselves.
  const [userPickedPkg, setUserPickedPkg] = useState(false)
  const loadPackages = useCallback(async (catId: number, cityId: number | undefined) => {
    setPkgsLoading(true)
    setPackages([])
    setSelectedPkgId(null)
    setUserPickedPkg(false)
    setEstimate(null)
    try {
      const pkgs = await rideApi.getRentalPackages(catId, cityId)
      setPackages(pkgs)
    } catch {
      setPackages([])
    } finally {
      setPkgsLoading(false)
    }
  }, [])

  useEffect(() => { void loadPackages(selectedCatId, originCityId) }, [selectedCatId, originCityId, loadPackages])

  useEffect(() => {
    if (!hasOrigin) router.replace('/home')
  }, [hasOrigin, router])

  // Live vehicle categories (passenger capacity, display name) from admin —
  // FALLBACK_CATEGORIES only covers the fetch failing.
  useEffect(() => {
    vehicleApi.getCategories().then(setCategories).catch(() => {})
  }, [])

  // selectedCatId defaults to FALLBACK_CATEGORIES' sedan id, which may not
  // exist once the real list loads (categories can be added/removed/reordered
  // from admin) — re-point to the first available category instead of
  // leaving selectedCat unresolved.
  useEffect(() => {
    if (categories.length > 0 && !categories.some(c => c.id === selectedCatId)) {
      setSelectedCatId(categories[0]!.id)
    }
  }, [categories, selectedCatId])

  // Fetch estimate whenever the selected package changes
  const estReq = useRef(0)
  const loadEstimate = useCallback(async (pkgId: number, catId: number) => {
    const reqId = ++estReq.current // drop responses from superseded selections
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
      if (reqId === estReq.current) setEstimate(est)
    } catch {
      if (reqId === estReq.current) setEstimate(null)
    } finally {
      if (reqId === estReq.current) setEstLoading(false)
    }
  }, [originCityId])

  useEffect(() => {
    if (selectedPkgId !== null) void loadEstimate(selectedPkgId, selectedCatId)
  }, [selectedPkgId, selectedCatId, loadEstimate])

  const recommendation = useMemo(
    () => (trip ? recommendPackage(packages, trip.km, trip.min) : null),
    [packages, trip],
  )
  useEffect(() => {
    if (userPickedPkg || !tripReady || packages.length === 0) return
    setSelectedPkgId(recommendation?.packageId ?? packages[0]!.id)
  }, [packages, recommendation, userPickedPkg, tripReady])

  const selectedCat = categories.find(c => c.id === selectedCatId)
  const selectedPkg = packages.find(p => p.id === selectedPkgId) ?? null
  const canBook     = selectedPkgId !== null && estimate !== null && !estLoading && !isBooking && hasDestination

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
        paymentChannel: getPaymentChannel(),
      }
      if (originCityId) params.originCityId = originCityId
      if (scheduledFor) params.scheduledFor = scheduledFor.toISOString()
      if (stops.length > 0) params.stops = stops
      if (hasDestination && destLat && destLng) {
        params.destinationLat = parseFloat(destLat)
        params.destinationLng = parseFloat(destLng)
        params.destinationAddress = destAddress!
      }
      if (riderName)  params.riderName  = riderName
      if (riderPhone) params.riderPhone = riderPhone
      const result = await rideApi.createBooking(params)
      router.push(scheduledFor ? '/history?scheduled=1' : `/ride/${result.rideId}`)
    } catch (err) {
      const status = isAxiosError(err) ? err.response?.status : undefined
      const serverMessage = isAxiosError(err) ? (err.response?.data as { error?: string } | undefined)?.error : undefined
      setBookError(status === 422 && serverMessage ? serverMessage : 'Booking failed. Please try again.')
      setIsBooking(false)
    }
  }

  if (!hasOrigin) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <OcarSpinner size={32} variant="mono" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden relative">

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
        <button
          onClick={() => setForMeOpen(true)}
          className="flex items-center gap-1.5 h-11 pl-2.5 pr-2 rounded-full bg-slate-100 flex-shrink-0 max-w-[130px]"
        >
          <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center flex-shrink-0">
            <Users size={11} strokeWidth={2} className="text-violet-600" />
          </span>
          <span className="text-xs font-semibold text-slate-800 truncate">
            {bookingForOther ? riderName : 'For me'}
          </span>
        </button>
      </div>

      <BookingForSheet
        open={forMeOpen}
        onClose={() => setForMeOpen(false)}
        riderName={riderName}
        riderPhone={riderPhone}
        onCommit={(n, p) => { setRiderName(n); setRiderPhone(p); setForMeOpen(false) }}
        onClearToMyself={() => { setRiderName(''); setRiderPhone(''); setForMeOpen(false) }}
      />

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

          {/* Drop-off (required) */}
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
                <span className="flex-1 text-[12px] font-medium text-slate-400">Add a drop-off</span>
              </button>
            )}
          </motion.section>

          {/* Plan your stops — free itinerary, never touches fare (§2.2 of the plan) */}
          <motion.section {...fadeUp(0)} className="space-y-2">
            <div className="px-1">
              <p className="text-[12px] font-bold" style={{ color: '#0F172A' }}>Plan your stops · optional</p>
              <p className="text-[11px] mt-0.5" style={{ color: '#64748B' }}>
                Tell your driver where you plan to go — you can always change your mind during the ride
              </p>
            </div>
            <RouteTimeline nodes={rentalStopNodes} />
          </motion.section>

          {/* Vehicle category */}
          <motion.section {...fadeUp(0)}>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
              Vehicle
            </p>
            <div className="grid grid-cols-5 gap-1.5">
              {categories.map(cat => {
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
                    <VehicleIcon slug={cat.slug} size={26} color={active ? '#0A9FB0' : '#64748B'} />
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
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
                Package
              </p>
              {trip && (
                <p className="text-[11px] font-medium text-slate-500 tabular-nums">
                  Your route · {trip.km} km · ~{formatDuration(trip.min)}
                </p>
              )}
            </div>

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
                  const isRec  = recommendation?.packageId === pkg.id
                  return (
                    <button
                      key={pkg.id}
                      onClick={() => { setUserPickedPkg(true); setSelectedPkgId(pkg.id) }}
                      className={cn(
                        'relative w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all duration-150 text-left',
                        active
                          ? 'bg-violet-50 border-violet-300 shadow-sm'
                          : 'bg-slate-50 border-slate-100 active:bg-slate-100',
                        isRec && !active && 'border-violet-200',
                        isRec && 'mt-2.5'
                      )}
                    >
                      {isRec && (
                        <span
                          className="absolute -top-2.5 left-4 flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[10px] font-bold tracking-wide text-white shadow-sm"
                          style={{ background: 'linear-gradient(135deg, #0A9FB0 0%, #DC3E93 100%)' }}
                        >
                          <Sparkles size={9} strokeWidth={2.5} />
                          Recommended for your trip
                        </span>
                      )}
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
                {recommendation?.exceeds && trip && (recommendation.overKm > 0 || recommendation.overMin > 0) && (
                  <div className="flex items-start gap-2.5 rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3">
                    <Info size={14} strokeWidth={2.2} className="text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-[11.5px] leading-relaxed text-amber-800">
                      Your route (~{trip.km} km, {formatDuration(trip.min)}) is longer than our biggest package.
                      {recommendation.overKm > 0 && <> About {recommendation.overKm} km over</>}
                      {recommendation.overKm > 0 && recommendation.overMin > 0 && ' and'}
                      {recommendation.overMin > 0 && <> {formatDuration(recommendation.overMin)} over</>}
                      {' '}will be charged as extra.
                    </p>
                  </div>
                )}
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
                      {selectedCat?.display_name} · {formatDuration(selectedPkg.duration_minutes)} / {selectedPkg.km_limit} km
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

        <p className="mx-4 mb-2 text-[11px] font-medium leading-relaxed text-slate-400">
          Waiting time is <span className="font-semibold text-slate-600">covered within your rental package</span>. Running over is billed as an hourly overage.
        </p>
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
          <button
            className="text-xs font-bold text-violet-600"
            onClick={() => { setPaymentNote('Cash only for now'); setTimeout(() => setPaymentNote(null), 2000) }}
          >
            Change
          </button>
        </div>
        {paymentNote && <p className="text-slate-500 text-xs text-center mb-2">{paymentNote}</p>}

        {bookError && (
          <p className="text-red-500 text-sm text-center mb-2">{bookError}</p>
        )}

        <button
          onClick={handleBook}
          disabled={!canBook}
          className="w-full py-4 rounded-2xl text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #0A9FB0 0%, #DC3E93 100%)',
            minHeight: 52,
          }}
        >
          {isBooking
            ? 'Booking…'
            : !selectedPkg
            ? 'Select a package'
            : !hasDestination
            ? 'Add a drop-off to continue'
            : estimate != null
            ? `${scheduledFor ? 'Schedule' : 'Book'} ${selectedCat?.display_name ?? ''} · ₹${Math.round(estimate.breakdown.total)}`
            : `${scheduledFor ? 'Schedule' : 'Book'} ${selectedCat?.display_name ?? ''}`
          }
        </button>
      </div>

      <AddStopSheet
        open={addStopOpen}
        onClose={() => setAddStopOpen(false)}
        onSelect={(s) => { setAddStopOpen(false); router.replace(`/rental?${buildCarriedParams([...stops, s]).toString()}`) }}
        title={`Add stop ${stops.length + 1}`}
        originLat={originLat}
        originLng={originLng}
      />
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
