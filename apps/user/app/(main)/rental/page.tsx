'use client'

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import {
  ArrowLeft, MapPin, Clock,
  CreditCard, Zap, Users, Navigation, ChevronDown, Info, Sparkles,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
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

// Luxury carries the app's own gold "premium tier" signal (same family as the
// Ocar Elite home-screen banner) so the top-of-fleet vehicle reads as genuinely
// premium rather than just another row in the list.
function isPremiumSlug(slug: string) {
  return slug === 'luxury'
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
  // Every category's packages are fetched up front (not just the selected one) so
  // every row can show a real "from ₹X" before the rider taps anything — the whole
  // point of a vertical list is comparing options without committing first.
  const [packagesByCat,   setPackagesByCat]   = useState<Record<number, RentalPackage[]>>({})
  const [pkgsLoading,     setPkgsLoading]     = useState(true)
  // Which vehicle's accordion row is open. null = every row collapsed.
  const [openCatId,       setOpenCatId]       = useState<number | null>(null)
  const [selectedPkgId,   setSelectedPkgId]  = useState<number | null>(null)
  const [userPickedPkg,   setUserPickedPkg]  = useState(false)
  const [estimate,        setEstimate]        = useState<FareEstimate | null>(null)
  const [estLoading,      setEstLoading]      = useState(false)
  const [isBooking,       setIsBooking]       = useState(false)
  const [bookError,       setBookError]       = useState<string | null>(null)
  const [paymentNote,     setPaymentNote]     = useState<string | null>(null)

  // Route pickup → stops → drop (drive distance/time). Non-traffic-aware: package tiers
  // are coarse (hours/tens of km), so live traffic wouldn't change the pick but would
  // double the routing cost per lookup.
  const [trip, setTrip] = useState<{ km: number; min: number } | null>(null)
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

  // Fetch every category's packages in parallel whenever the category list or city changes.
  const loadAllPackages = useCallback(async (cats: Category[], cityId: number | undefined) => {
    setPkgsLoading(true)
    const entries = await Promise.allSettled(
      cats.map(async cat => [cat.id, await rideApi.getRentalPackages(cat.id, cityId)] as const)
    )
    const next: Record<number, RentalPackage[]> = {}
    for (const r of entries) if (r.status === 'fulfilled') next[r.value[0]] = r.value[1]
    setPackagesByCat(next)
    setPkgsLoading(false)
  }, [])

  useEffect(() => { void loadAllPackages(categories, originCityId) }, [categories, originCityId, loadAllPackages])

  useEffect(() => {
    if (!hasOrigin) router.replace('/home')
  }, [hasOrigin, router])

  // Live vehicle categories (passenger capacity, display name) from admin —
  // FALLBACK_CATEGORIES only covers the fetch failing.
  useEffect(() => {
    vehicleApi.getCategories().then(setCategories).catch(() => {})
  }, [])

  // Default-open the sedan-equivalent row (or the first category) once the
  // category list settles, so the sheet never opens fully collapsed.
  useEffect(() => {
    setOpenCatId(prev => {
      if (prev !== null && categories.some(c => c.id === prev)) return prev
      if (categories.length === 0) return null
      return (categories.find(c => c.slug === 'sedan') ?? categories[0])!.id
    })
  }, [categories])

  const openPackages = useMemo(
    () => (openCatId !== null ? (packagesByCat[openCatId] ?? []) : []),
    [openCatId, packagesByCat],
  )
  const recommendation = useMemo(
    () => (trip ? recommendPackage(openPackages, trip.km, trip.min) : null),
    [openPackages, trip],
  )

  // Selection follows the recommendation until the rider picks a package themselves,
  // and resets whenever a different vehicle's row is opened.
  useEffect(() => {
    if (userPickedPkg || !tripReady || openPackages.length === 0) { if (openPackages.length === 0) setSelectedPkgId(null); return }
    setSelectedPkgId(recommendation?.packageId ?? openPackages[0]!.id)
  }, [openCatId, openPackages, recommendation, userPickedPkg, tripReady])

  useEffect(() => {
    if (selectedPkgId === null || openCatId === null) { setEstimate(null); return }
    let cancelled = false
    setEstLoading(true)
    setEstimate(null)
    rideApi.getEstimate({
      categoryId:      openCatId,
      rideType:        'rental',
      rentalPackageId: selectedPkgId,
      distanceKm:      0,
      durationMin:     0,
      originCityId,
    })
      .then(est => { if (!cancelled) setEstimate(est) })
      .catch(() => { if (!cancelled) setEstimate(null) })
      .finally(() => { if (!cancelled) setEstLoading(false) })
    return () => { cancelled = true }
  }, [selectedPkgId, openCatId, originCityId])

  function toggleCategory(catId: number) {
    if (openCatId === catId) {
      setOpenCatId(null)
      setSelectedPkgId(null)
      return
    }
    setOpenCatId(catId)
    setUserPickedPkg(false)
    setSelectedPkgId(null)
  }

  const selectedCat = categories.find(c => c.id === openCatId)
  const selectedPkg = openPackages.find(p => p.id === selectedPkgId) ?? null
  const canBook = openCatId !== null && selectedPkgId !== null && estimate !== null && !estLoading && !isBooking && hasDestination

  async function handleBook() {
    if (openCatId === null || selectedPkgId === null || !selectedPkg) return
    setIsBooking(true)
    setBookError(null)
    try {
      const params: Parameters<typeof rideApi.createBooking>[0] = {
        categoryId:      openCatId,
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
            <MapPin size={10} strokeWidth={2.5} className="text-primary flex-shrink-0" />
            <p className="text-[11px] text-slate-400 truncate">{originAddress}</p>
          </div>
        </div>
        <button
          onClick={() => setForMeOpen(true)}
          className="flex items-center gap-1.5 h-11 pl-2.5 pr-2 rounded-full bg-slate-100 flex-shrink-0 max-w-[130px]"
        >
          <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center flex-shrink-0">
            <Users size={11} strokeWidth={2} className="text-primary" />
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
        <div className="px-4 pt-5 pb-6 space-y-5">

          {/* Trip summary card: time + drop-off + stops unified into one glanceable card */}
          <motion.section {...fadeUp(0)} className="rounded-2xl bg-white border border-border-light shadow-card p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <PickupTimeChip
                value={scheduledFor}
                pickerOpen={schedulePickerOpen}
                onOpenPicker={() => setSchedulePickerOpen(true)}
                onClosePicker={() => setSchedulePickerOpen(false)}
                onChange={setScheduledFor}
              />
              {trip && (
                <span className="text-[11px] font-semibold text-slate-400 tabular-nums">{trip.km} km · ~{formatDuration(trip.min)}</span>
              )}
            </div>
            <div className="h-px bg-border-light" />
            {hasDestination ? (
              <button onClick={addDestination} className="w-full flex items-center gap-2.5 text-left">
                <Navigation size={13} strokeWidth={2.2} className="text-primary flex-shrink-0" />
                <span className="flex-1 min-w-0 text-[13px] font-bold text-slate-900 truncate">{destAddress}</span>
                <span className="text-[10px] font-bold text-primary flex-shrink-0">Change</span>
              </button>
            ) : (
              <button
                onClick={addDestination}
                className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors active:bg-slate-50"
                style={{ border: '1.5px dashed #CBD5E1' }}
              >
                <Navigation size={13} strokeWidth={2.2} className="text-slate-400 flex-shrink-0" />
                <span className="flex-1 text-[12px] font-medium text-slate-400">Add a drop-off</span>
              </button>
            )}
            <button
              onClick={() => setAddStopOpen(true)}
              className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors active:bg-slate-50"
              style={{ border: '1.5px dashed #CBD5E1' }}
            >
              <span className="text-slate-400 text-[13px] leading-none">+</span>
              <span className="text-[12px] font-medium text-slate-400">Add a stop · optional</span>
            </button>
          </motion.section>

          {rentalStopNodes.length > 1 && (
            <motion.section {...fadeUp(0)}>
              <RouteTimeline nodes={rentalStopNodes} />
            </motion.section>
          )}

          {/* Vehicle list — every option visible on one vertical scroll. Tap a row to
              open it; its package tiers render as chips inline, nothing hidden off-screen. */}
          <motion.section {...fadeUp(0.04)} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Choose your ride</p>
              <p className="text-[10px] font-semibold text-slate-400">{categories.length} options</p>
            </div>

            {categories.map(cat => {
              const isOpen = openCatId === cat.id
              const pkgs = packagesByCat[cat.id] ?? []
              const fromFare = pkgs.length > 0 ? Math.min(...pkgs.map(p => num(p.package_fare))) : null
              const premium = isPremiumSlug(cat.slug)
              const noPkgs = !pkgsLoading && pkgs.length === 0

              return (
                <div
                  key={cat.id}
                  className={cn(
                    'rounded-2xl border overflow-hidden transition-all duration-150',
                    isOpen ? 'border-primary shadow-float bg-white' : 'border-border-light bg-white'
                  )}
                >
                  <button
                    onClick={() => !noPkgs && toggleCategory(cat.id)}
                    disabled={noPkgs}
                    className={cn('w-full flex items-center gap-3 p-3 text-left', noPkgs && 'opacity-40 cursor-not-allowed')}
                  >
                    <div
                      className={cn(
                        'w-[52px] h-11 rounded-xl flex items-center justify-center flex-shrink-0',
                        premium ? '' : isOpen ? 'bg-primary-subtle' : 'bg-surface-2'
                      )}
                      style={premium ? { background: 'linear-gradient(135deg, #F3D9A6 0%, #E0B662 55%, #C9974A 100%)', boxShadow: '0 4px 12px rgba(201,151,74,0.30)' } : undefined}
                    >
                      <VehicleIcon slug={cat.slug} size={26} color={premium ? '#FFFFFF' : isOpen ? '#0A9FB0' : '#64748B'} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px] font-bold text-slate-900">{cat.display_name}</span>
                        {premium && (
                          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold tracking-wide px-1.5 py-0.5 rounded-full" style={{ color: '#8A6323', background: '#FBF3E6' }}>
                            <Sparkles size={8} />PREMIUM FLEET
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5 text-[11px] text-slate-400">
                        <Users size={9} strokeWidth={2.5} />{cat.max_passengers} seats
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      {noPkgs ? (
                        <span className="text-[11px] font-semibold text-slate-400">No packages</span>
                      ) : pkgsLoading ? (
                        <div className="w-16 h-4 rounded bg-slate-100 animate-pulse ml-auto" />
                      ) : isOpen && selectedPkg ? (
                        <span className="text-[15px] font-black text-slate-900 tabular-nums">₹{Math.round(num(selectedPkg.package_fare))}</span>
                      ) : fromFare != null ? (
                        <span className="text-[14px] font-black text-slate-900 tabular-nums">from ₹{Math.round(fromFare)}</span>
                      ) : null}
                    </div>
                    <ChevronDown size={14} strokeWidth={2.5} className={cn('text-slate-300 flex-shrink-0 transition-transform', isOpen && 'rotate-180 text-primary')} />
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div className="mx-1.5 mb-1.5 rounded-xl bg-surface-2 p-3">
                          {pkgsLoading ? (
                            <div className="flex gap-2">
                              {[1, 2, 3].map(i => <div key={i} className="h-12 w-20 rounded-xl bg-slate-100 animate-pulse" />)}
                            </div>
                          ) : (
                            <>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Package · {pkgs.length} tiers</p>
                              <div className="flex gap-2 overflow-x-auto pt-3 pb-1 mb-3 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
                                {pkgs.map(pkg => {
                                  const active = pkg.id === selectedPkgId
                                  const isRec = recommendation?.packageId === pkg.id
                                  return (
                                    <button
                                      key={pkg.id}
                                      onClick={() => { setUserPickedPkg(true); setSelectedPkgId(pkg.id) }}
                                      className={cn(
                                        'relative flex-shrink-0 px-3.5 py-2 rounded-xl text-center transition-all',
                                        active ? 'bg-primary shadow-button' : 'bg-white border border-border-light'
                                      )}
                                    >
                                      {isRec && (
                                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white text-primary-dark whitespace-nowrap shadow-sm">
                                          BEST FIT
                                        </span>
                                      )}
                                      <p className={cn('text-[11.5px] font-bold', active ? 'text-white' : 'text-slate-900')}>
                                        {formatDuration(pkg.duration_minutes)}
                                      </p>
                                      <p className={cn('text-[9.5px]', active ? 'text-primary-light' : 'text-slate-400')}>
                                        {pkg.km_limit} km
                                      </p>
                                    </button>
                                  )
                                })}
                              </div>
                              {selectedPkg && (
                                <>
                                  <div className="h-px bg-border-light mb-2.5" />
                                  <div className="flex items-center justify-between">
                                    <div className="min-w-0">
                                      <p className="text-[11.5px] text-slate-500 font-medium truncate">
                                        {formatDuration(selectedPkg.duration_minutes)} · {selectedPkg.km_limit} km ·{' '}
                                        <span className="font-bold text-primary-dark">extra ₹{num(selectedPkg.extra_per_km)}/km</span>
                                      </p>
                                      {estimate != null && estimate.surge_multiplier > 1 && (
                                        <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-500 mt-0.5">
                                          <Zap size={9} />{estimate.surge_multiplier}× surge
                                        </span>
                                      )}
                                    </div>
                                    {estLoading ? (
                                      <div className="w-14 h-5 bg-slate-200 rounded animate-pulse flex-shrink-0" />
                                    ) : estimate != null ? (
                                      <span className="text-[19px] font-black text-primary tabular-nums flex-shrink-0">
                                        ₹<AnimatedNumber value={Math.round(estimate.breakdown.total)} />
                                      </span>
                                    ) : (
                                      <span className="text-slate-400 text-sm flex-shrink-0">—</span>
                                    )}
                                  </div>
                                </>
                              )}
                              {recommendation?.exceeds && trip && (recommendation.overKm > 0 || recommendation.overMin > 0) && (
                                <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5 mt-2.5">
                                  <Info size={13} strokeWidth={2.2} className="text-amber-600 mt-0.5 flex-shrink-0" />
                                  <p className="text-[11px] leading-relaxed text-amber-800">
                                    Your route (~{trip.km} km, {formatDuration(trip.min)}) is longer than the biggest package.
                                    {recommendation.overKm > 0 && <> About {recommendation.overKm} km over</>}
                                    {recommendation.overKm > 0 && recommendation.overMin > 0 && ' and'}
                                    {recommendation.overMin > 0 && <> {formatDuration(recommendation.overMin)} over</>}
                                    {' '}will be charged as extra.
                                  </p>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </motion.section>
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
            className="text-xs font-bold text-primary"
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
          className="w-full py-4 rounded-2xl text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40 bg-gradient-primary shadow-button"
          style={{ minHeight: 52 }}
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
