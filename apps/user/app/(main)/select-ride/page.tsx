'use client'

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowRightLeft, ChevronRight, Users, Zap, Clock, CreditCard, RotateCcw } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn, swapAt } from '@/lib/utils'
import { isAxiosError } from 'axios'
import { rideApi, type FareEstimate, type StopInput } from '@/lib/ride-api'
import { vehicleApi, type VehicleCategory } from '@/lib/vehicle-api'
import RouteTimeline, { type TimelineNode } from '@/components/route/RouteTimeline'
import AddStopSheet from '@/components/route/AddStopSheet'
import { getPaymentChannel } from '@/lib/payment-channel'
import { geoApi } from '@/lib/geo-api'
import AnimatedNumber from '@/components/ui/AnimatedNumber'
import { VehicleIcon } from '@/components/ui/VehicleIcon'
import PickupTimeChip from '@/components/ui/PickupTimeChip'

const SelectRideMapScene = dynamic(() => import('@/components/map/SelectRideMapScene'), { ssr: false })

const EASE = [0.22, 1, 0.36, 1] as const

type Category = VehicleCategory

const FALLBACK_CATEGORIES: Category[] = [
  { id: 1, slug: 'hatchback', display_name: 'Hatchback', max_passengers: 4 },
  { id: 2, slug: 'sedan',     display_name: 'Sedan',     max_passengers: 4 },
  { id: 3, slug: 'suv',       display_name: 'SUV',       max_passengers: 6 },
  { id: 4, slug: 'luxury',    display_name: 'Luxury',    max_passengers: 4 },
]

const HOUR_OPTIONS = [4, 6, 8, 10, 12] as const

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

function SelectRideContent() {
  const router = useRouter()
  const sp     = useSearchParams()

  const originLat          = parseFloat(sp.get('originLat') ?? '')
  const originLng          = parseFloat(sp.get('originLng') ?? '')
  const originAddress      = sp.get('originAddress') ?? 'Pickup'
  const destinationLat     = parseFloat(sp.get('destinationLat') ?? '')
  const destinationLng     = parseFloat(sp.get('destinationLng') ?? '')
  const destinationAddress = sp.get('destinationAddress') ?? 'Destination'
  const hasOriginDest      = !isNaN(originLat) && !isNaN(originLng) && !isNaN(destinationLat) && !isNaN(destinationLng)
  const distanceKm         = parseFloat(sp.get('distanceKm') ?? '10')
  const durationMin        = parseFloat(sp.get('durationMin') ?? '20')
  const originCityId       = parseInt(sp.get('originCityId') ?? '1', 10)
  const encodedPolyline    = sp.get('polyline') ?? undefined
  const riderName          = sp.get('riderName') ?? undefined
  const riderPhone         = sp.get('riderPhone') ?? undefined

  // When arriving from /round-trip, tripHours is in the URL and rideType is round_trip
  const tripHoursFromUrl   = sp.get('tripHours') ? parseInt(sp.get('tripHours')!) : undefined
  const fromRoundTripPage  = tripHoursFromUrl !== undefined && sp.get('rideType') === 'round_trip'

  // Stops apply to one-way (priced via detour distance) and round trip (flat
  // per-stop fee). Rental books directly from /rental, so it never lands here.
  const stops: StopInput[] = useMemo(() => {
    const out: StopInput[] = []
    for (let i = 0; i < 3; i++) {
      const lat     = sp.get(`stops[${i}][lat]`)
      const lng     = sp.get(`stops[${i}][lng]`)
      const address = sp.get(`stops[${i}][address]`)
      if (lat && lng && address !== null) out.push({ lat: parseFloat(lat), lng: parseFloat(lng), address })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp])

  const [categories,        setCategories]        = useState<Category[]>(FALLBACK_CATEGORIES)
  const [rideType,          setRideType]          = useState<'one_way' | 'round_trip'>(
    () => sp.get('rideType') === 'round_trip' ? 'round_trip' : 'one_way'
  )
  // Only used when user switches to round_trip inline (without coming from /round-trip)
  const [inlineTripHours,   setInlineTripHours]   = useState<number | null>(null)
  const [estimates,         setEstimates]         = useState<Record<number, FareEstimate>>({})
  const [loading,           setLoading]           = useState(true)
  const [selected,          setSelected]          = useState(2)
  const [isReturnCab,       setIsReturnCab]       = useState(false)
  const [isBooking,         setIsBooking]         = useState(false)
  const [etaReady,          setEtaReady]          = useState(false)
  const [bookError,         setBookError]         = useState<string | null>(null)
  const [nearbyDrivers,     setNearbyDrivers]     = useState<Array<{ driver_id: string; lat: number; lng: number; category_id: number }>>([])
  const [returnCabCategories, setReturnCabCategories] = useState<Set<number>>(new Set())
  const [returnCabEstimates,  setReturnCabEstimates]  = useState<Record<number, FareEstimate>>({})
  const [scheduledFor,     setScheduledFor]     = useState<Date | null>(() => {
    const raw = sp.get('scheduledFor')
    return raw ? new Date(raw) : null
  })
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false)

  // One-way stops are priced through the detour: sum the routed legs
  // origin→stop→…→dest and feed the total distance to the estimate + booking.
  // Round-trip keeps its base origin↔dest distance (stops there are a flat fee).
  const [routedDistanceKm, setRoutedDistanceKm] = useState<number | null>(null)
  const [routedDurationMin, setRoutedDurationMin] = useState<number | null>(null)
  const [routedLegPolylines, setRoutedLegPolylines] = useState<string[]>([])
  const [routingStops, setRoutingStops] = useState(false)
  const detourPriced = rideType === 'one_way' && stops.length > 0
  const effectiveDistanceKm = detourPriced && routedDistanceKm != null ? routedDistanceKm : distanceKm
  const effectiveDurationMin = detourPriced && routedDurationMin != null ? routedDurationMin : durationMin

  // One Way and Round Trip can never serve an in-city trip (docs/RIDE_TYPES_PLAN.md —
  // Round Trip is outstation-only, Rental is in-city-only; the backend 422s this at
  // booking time). This screen has no other guard against reaching it for an in-city
  // destination, so classify on mount and bounce to /rental if it happens.
  const [redirectToast, setRedirectToast] = useState<string | null>(null)

  useEffect(() => {
    if (!hasOriginDest) router.replace('/home')
  }, [hasOriginDest, router])

  // Live vehicle categories (passenger capacity, display name) from admin —
  // FALLBACK_CATEGORIES only covers the fetch failing.
  useEffect(() => {
    vehicleApi.getCategories().then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    if (!hasOriginDest) return
    let cancelled = false
    geoApi.classifyTrip(originLat, originLng, destinationLat, destinationLng)
      .then(c => {
        if (cancelled || c.scope !== 'in_city') return
        const cityLabel = c.cityName ?? 'the city'
        setRedirectToast(`That's inside ${cityLabel}, switching to City Rides`)
        const params = new URLSearchParams({
          originLat: String(originLat), originLng: String(originLng), originAddress,
          destinationAddress, destinationLat: String(destinationLat), destinationLng: String(destinationLng),
          originCityId: String(originCityId),
        })
        if (scheduledFor) params.set('scheduledFor', scheduledFor.toISOString())
        if (riderName)  params.set('riderName', riderName)
        if (riderPhone) params.set('riderPhone', riderPhone)
        setTimeout(() => { if (!cancelled) router.replace(`/rental?${params.toString()}`) }, 1500)
      })
      .catch(() => {})
    return () => { cancelled = true }
  // Only the trip identity should trigger a reclassification, not every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originLat, originLng, destinationLat, destinationLng])

  // Route through the waypoints so one-way fare covers the real detour. Summing
  // per-leg routed distance IS the through-waypoint total, so no waypoint-aware
  // routing endpoint is needed — reuse the existing origin→dest getRoute per leg.
  const stopsKey = stops.map(s => `${s.lat},${s.lng}`).join('|')
  useEffect(() => {
    if (!detourPriced) { setRoutedDistanceKm(null); setRoutedDurationMin(null); setRoutedLegPolylines([]); return }
    let cancelled = false
    setRoutingStops(true)
    const points = [
      { lat: originLat, lng: originLng },
      ...stops,
      { lat: destinationLat, lng: destinationLng },
    ]
    Promise.all(
      points.slice(0, -1).map((p, i) => {
        const n = points[i + 1]!
        return geoApi.getRoute(p.lat, p.lng, n.lat, n.lng)
      })
    )
      .then(legs => {
        if (cancelled) return
        setRoutedDistanceKm(Math.round(legs.reduce((s, l) => s + l.distanceKm, 0) * 10) / 10)
        setRoutedDurationMin(Math.round(legs.reduce((s, l) => s + l.durationMin, 0)))
        // Only draw the per-leg detour if EVERY leg has a polyline; a partial set
        // would render a gapped route, so fall back ([]) to the origin→dest line.
        const polys = legs.map(l => l.polyline).filter((p): p is string => !!p)
        setRoutedLegPolylines(polys.length === legs.length ? polys : [])
      })
      .catch(() => { if (!cancelled) { setRoutedDistanceKm(null); setRoutedDurationMin(null); setRoutedLegPolylines([]) } })
      .finally(() => { if (!cancelled) setRoutingStops(false) })
    return () => { cancelled = true }
  // stopsKey captures stop identity+order; the primitive coords cover origin/dest moves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detourPriced, stopsKey, originLat, originLng, destinationLat, destinationLng])

  // tripHours: from URL (round_trip from /round-trip page) or inline selection
  const tripHours = rideType === 'round_trip'
    ? (tripHoursFromUrl ?? inlineTripHours ?? undefined)
    : undefined

  useEffect(() => {
    const fetch = async () => {
      try { setNearbyDrivers(await rideApi.getNearbyDrivers(originLat, originLng)) } catch {}
    }
    void fetch()
    const id = setInterval(fetch, 8000)
    return () => clearInterval(id)
  }, [originLat, originLng])

  const driverEta = useMemo(() => {
    const result: Record<number, { count: number; etaMin: number }> = {}
    for (const cat of categories) {
      const inCat = nearbyDrivers.filter(d => d.category_id === cat.id)
      if (inCat.length === 0) { result[cat.id] = { count: 0, etaMin: -1 }; continue }
      const nearest = Math.min(...inCat.map(d => haversineKm(originLat, originLng, d.lat, d.lng)))
      result[cat.id] = { count: inCat.length, etaMin: Math.max(1, Math.round(nearest / 0.5)) }
    }
    return result
  }, [nearbyDrivers, categories, originLat, originLng])

  // Auto-select first available category once ETA data arrives
  useEffect(() => {
    if (Object.keys(driverEta).length === 0) return
    setEtaReady(true)
    if ((driverEta[selected]?.count ?? 0) === 0) {
      const first = categories.find(c => (driverEta[c.id]?.count ?? 0) > 0)
      if (first) setSelected(first.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverEta])

  const center: [number, number] = [(originLat + destinationLat) / 2, (originLng + destinationLng) / 2]

  const loadEstimates = useCallback(async () => {
    setLoading(true)
    const results: Record<number, FareEstimate> = {}
    const rcResults: Record<number, FareEstimate> = {}
    const rcAvailable = new Set<number>()

    await Promise.allSettled(
      categories.map(async cat => {
        try {
          const estParams: Parameters<typeof rideApi.getEstimate>[0] = {
            categoryId: cat.id, rideType,
            distanceKm: effectiveDistanceKm, durationMin: effectiveDurationMin, originCityId,
            tripHours,
          }
          if (rideType === 'round_trip') estParams.stopCount = stops.length
          results[cat.id] = await rideApi.getEstimate(estParams)
        } catch {}

        // Parallel: check return cab availability for one_way rides.
        // A detour with stops can't match a return driver's fixed route, so skip it.
        if (rideType === 'one_way' && stops.length === 0) {
          try {
            const rc = await rideApi.getReturnCabAvailable({
              pickupLat: originLat, pickupLng: originLng,
              dropLat: destinationLat, dropLng: destinationLng,
              categoryId: cat.id,
            })
            if (rc.count > 0) {
              rcAvailable.add(cat.id)
              rcResults[cat.id] = await rideApi.getEstimate({
                categoryId: cat.id, rideType: 'one_way',
                isReturnCab: true,
                distanceKm, durationMin, originCityId,
              })
            }
          } catch {}
        }
      })
    )

    setEstimates(results)
    setReturnCabCategories(rcAvailable)
    setReturnCabEstimates(rcResults)
    setLoading(false)
  }, [categories, rideType, effectiveDistanceKm, effectiveDurationMin, originCityId, tripHours, originLat, originLng, destinationLat, destinationLng, stops.length])

  useEffect(() => { void loadEstimates() }, [loadEstimates])

  const handleBook = async () => {
    setIsBooking(true)
    setBookError(null)
    try {
      const bookingParams: Parameters<typeof rideApi.createBooking>[0] = {
        categoryId: selected, rideType,
        originLat, originLng, originAddress,
        destinationLat, destinationLng, destinationAddress,
        distanceKm: effectiveDistanceKm, durationMin: effectiveDurationMin,
        paymentChannel: getPaymentChannel(),
      }
      if (originCityId)            bookingParams.originCityId  = originCityId
      if (tripHours !== undefined) bookingParams.tripHours     = tripHours
      if (isReturnCab)             bookingParams.isReturnCab   = true
      if (scheduledFor)            bookingParams.scheduledFor  = scheduledFor.toISOString()
      if (stops.length > 0) bookingParams.stops = stops
      if (riderName)  bookingParams.riderName  = riderName
      if (riderPhone) bookingParams.riderPhone = riderPhone
      const result = await rideApi.createBooking(bookingParams)
      router.push(scheduledFor ? '/history?scheduled=1' : `/ride/${result.rideId}`)
    } catch (err) {
      const status = isAxiosError(err) ? err.response?.status : undefined
      const serverMessage = isAxiosError(err) ? (err.response?.data as { error?: string } | undefined)?.error : undefined
      setBookError(status === 422 && serverMessage ? serverMessage : 'Booking failed. Please try again.')
    } finally {
      setIsBooking(false)
    }
  }

  const activeEst       = isReturnCab ? returnCabEstimates[selected] : estimates[selected]
  const selectedFare    = activeEst?.breakdown.total
  const selectedCat     = categories.find(c => c.id === selected)!
  // Driver-availability gating is meaningless for a scheduled ride, dispatch
  // (and therefore driver search) doesn't happen until the buffer window later.
  const allUnavailable  = !scheduledFor && etaReady && categories.every(c => (driverEta[c.id]?.count ?? 0) === 0)

  function goBackToSearch(focus: 'origin' | 'destination') {
    const params = new URLSearchParams({
      originLat: String(originLat), originLng: String(originLng), originAddress,
      destinationLat: String(destinationLat), destinationLng: String(destinationLng), destinationAddress,
      focus,
      backTo: 'select-ride',
      rideType,
    })
    if (rideType === 'round_trip' && tripHours) params.set('tripHours', String(tripHours))
    if (scheduledFor) params.set('scheduledFor', scheduledFor.toISOString())
    if (riderName)  params.set('riderName', riderName)
    if (riderPhone) params.set('riderPhone', riderPhone)
    stops.forEach((s, i) => {
      params.set(`stops[${i}][address]`, s.address)
      params.set(`stops[${i}][lat]`, String(s.lat))
      params.set(`stops[${i}][lng]`, String(s.lng))
    })
    router.push(`/search?${params.toString()}`)
  }

  const [addStopOpen, setAddStopOpen] = useState(false)

  function writeStops(nextStops: StopInput[]) {
    const params = new URLSearchParams(sp.toString())
    for (let i = 0; i < 3; i++) {
      params.delete(`stops[${i}][address]`)
      params.delete(`stops[${i}][lat]`)
      params.delete(`stops[${i}][lng]`)
    }
    nextStops.forEach((s, i) => {
      params.set(`stops[${i}][address]`, s.address)
      params.set(`stops[${i}][lat]`, String(s.lat))
      params.set(`stops[${i}][lng]`, String(s.lng))
    })
    router.replace(`/select-ride?${params.toString()}`)
  }

  function removeStop(index: number) {
    writeStops(stops.filter((_, i) => i !== index))
  }

  function swapStops(index: number) {
    writeStops(swapAt(stops, index))
  }

  const stopNodes: TimelineNode[] = stops.map((s, i) => ({
    kind: 'stop' as const,
    key: `${s.lat}-${s.lng}`,
    address: s.address,
    onRemove: () => removeStop(i),
    ...(i < stops.length - 1 ? { onSwap: () => swapStops(i) } : {}),
  }))
  if (stops.length < 3) {
    stopNodes.push(stops.length > 0
      ? {
          kind: 'add',
          onTap: () => setAddStopOpen(true),
          hint: routingStops ? 'Updating fare…' : detourPriced ? 'Fare covers the detour' : `${stops.length} on the way`,
        }
      : { kind: 'add', onTap: () => setAddStopOpen(true) })
  }

  // Round trip disabled when no hours selected
  const roundTripMissingHours = rideType === 'round_trip' && tripHours === undefined

  if (!hasOriginDest) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <OcarSpinner size={32} variant="mono" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white relative">

      {/* ── Map ── */}
      <div className="relative flex-shrink-0" style={{ height: '42%' }}>
        <SelectRideMapScene
          center={center}
          pickupPos={[originLat, originLng]}
          dropPos={[destinationLat, destinationLng]}
          encodedPolyline={encodedPolyline}
          stops={stops.map(s => [s.lat, s.lng] as [number, number])}
          legPolylines={detourPriced && routedLegPolylines.length > 0 ? routedLegPolylines : undefined}
          nearbyDrivers={nearbyDrivers}
        />
        <div className="absolute top-4 left-4 right-4 z-10 flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 bg-white rounded-2xl shadow-md flex items-center justify-center flex-shrink-0"
          >
            <ArrowLeft size={17} strokeWidth={2} className="text-slate-800" />
          </button>
          <div className="flex-1 h-10 bg-white rounded-2xl shadow-md flex items-center overflow-hidden">
            <button
              onClick={() => goBackToSearch('origin')}
              className="flex-1 min-w-0 h-full flex items-center pl-3 pr-1"
            >
              <span className="block w-full text-[12px] font-medium text-slate-500 truncate">{originAddress}</span>
            </button>
            <ChevronRight size={12} strokeWidth={2.5} className="text-slate-300 flex-shrink-0" />
            <button
              onClick={() => goBackToSearch('destination')}
              className="flex-1 min-w-0 h-full flex items-center pl-1 pr-3"
            >
              <span className="block w-full text-[12px] font-semibold text-slate-900 truncate">{destinationAddress}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Sheet ── */}
      <div
        className="flex-1 flex flex-col bg-white min-h-0"
        style={{ boxShadow: '0 -6px 32px rgba(79,70,229,0.10)', borderRadius: '24px 24px 0 0', marginTop: -8, position: 'relative', zIndex: 2 }}
      >
        {/* Handle + header */}
        <div className="flex-shrink-0 px-5 pt-2 pb-2">
          <div className="w-9 h-1 rounded-full mx-auto mb-2.5" style={{ background: 'rgba(79,70,229,0.15)' }} />
          <div className="flex items-center justify-between mb-2">
            <p className="text-[15px] font-bold text-slate-900">Choose a ride</p>
            <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
              {effectiveDistanceKm} km · {rideType === 'round_trip' ? 'round trip' : `${Math.round(effectiveDurationMin)} min`}
            </span>
          </div>

          {/* Pickup time, own row, above ride-type/car selection */}
          <div className="mb-2">
            <PickupTimeChip
              value={scheduledFor}
              pickerOpen={schedulePickerOpen}
              onOpenPicker={() => setSchedulePickerOpen(true)}
              onClosePicker={() => setSchedulePickerOpen(false)}
              onChange={(d) => { setScheduledFor(d); if (d) setIsReturnCab(false) }}
            />
          </div>

          {/* Ride type tabs, hidden when user arrived from /round-trip (already committed) */}
          {!fromRoundTripPage && (
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-2">
              {(['one_way', 'round_trip'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => {
                    setRideType(t)
                    setIsReturnCab(false)
                    if (t === 'one_way') setInlineTripHours(null)
                  }}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-[13px] font-semibold transition-all',
                    rideType === t
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500'
                  )}
                >
                  {t === 'one_way' ? 'One Way' : 'Round Trip'}
                </button>
              ))}
            </div>
          )}

          {/* Round trip hours row */}
          {rideType === 'round_trip' && (
            fromRoundTripPage && tripHoursFromUrl ? (
              // Arrived from /round-trip with hours already selected, show compact info
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl mb-1"
                style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}
              >
                <RotateCcw size={11} strokeWidth={2.5} className="flex-shrink-0" style={{ color: '#4F46E5' }} />
                <span className="text-[12px] font-semibold" style={{ color: '#4338CA' }}>
                  Round Trip · {tripHoursFromUrl}h
                </span>
                <span className="text-[12px] text-indigo-300 ml-auto">Driver stays with you</span>
              </div>
            ) : (
              // Inline hour chip selector
              <div className="mb-2">
                <p className="text-[11px] font-semibold text-slate-500 mb-1.5">How long do you need the driver?</p>
                <div className="flex gap-1.5">
                  {HOUR_OPTIONS.map(h => {
                    const active = inlineTripHours === h
                    return (
                      <button
                        key={h}
                        onClick={() => setInlineTripHours(h)}
                        className="flex-1 py-1.5 rounded-lg text-[12px] font-bold transition-all"
                        style={{
                          background: active ? '#4F46E5' : '#EEF2FF',
                          color:      active ? '#FFFFFF' : '#4F46E5',
                          border:     active ? '1.5px solid #4F46E5' : '1.5px solid #C7D2FE',
                        }}
                      >
                        {h}h
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          )}
        </div>

        {/* No drivers banner */}
        {allUnavailable && (
          <div className="mx-4 mb-1 flex items-center gap-2 rounded-xl px-3 py-2 bg-amber-50 border border-amber-200">
            <Clock size={14} className="text-amber-600 flex-shrink-0" />
            <p className="text-[12px] font-semibold text-amber-800">No drivers nearby. Try again in a few minutes.</p>
          </div>
        )}

        {/* Ride list, scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>

          {/* ── Stops itinerary — up to 3 waypoints; one-way prices the detour, round trip a flat per-stop fee ── */}
          {!isReturnCab && (stops.length > 0 || rideType === 'one_way' || !fromRoundTripPage) && (
            <div className="mx-4 mt-2 mb-1">
              <RouteTimeline nodes={stopNodes} />
            </div>
          )}

          {/* Wait-charge disclosure — Bolt-style "shown before you confirm" (one-way) */}
          {detourPriced && (
            <p className="mx-4 mb-1 text-[11px] font-medium leading-relaxed" style={{ color: '#94A3B8' }}>
              Each stop includes <span className="font-semibold" style={{ color: '#475569' }}>10 min free wait</span>. Longer waits are billed per minute and added to your final fare.
            </p>
          )}

          {/* ── Return Cab section (one_way only, when available) ── */}
          {/* Return-cab matches a specific driver's live route right now, meaningless for a future scheduled pickup. */}
          {rideType === 'one_way' && !scheduledFor && returnCabCategories.size > 0 && (
            <div>
              <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#059669' }}>
                Return Cab Available
              </p>
              {categories
                .filter(cat => returnCabCategories.has(cat.id))
                .map(cat => {
                  const rcEst   = returnCabEstimates[cat.id]
                  const stdEst  = estimates[cat.id]
                  const rcFare  = rcEst?.breakdown.total
                  const stdFare = stdEst?.breakdown.total
                  const isSel   = isReturnCab && selected === cat.id

                  return (
                    <button
                      key={`rc-${cat.id}`}
                      onClick={() => { setSelected(cat.id); setIsReturnCab(true) }}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 transition-colors duration-150 text-left',
                        isSel ? 'bg-emerald-50' : 'active:bg-slate-50 cursor-pointer'
                      )}
                    >
                      <div className={cn(
                        'w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0',
                        isSel ? 'bg-emerald-100' : 'bg-emerald-50'
                      )}>
                        <VehicleIcon slug={cat.slug} size={32} color="#059669" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 uppercase tracking-wide">
                            Return Cab
                          </span>
                          <p className={cn('text-[14px] font-bold leading-tight', isSel ? 'text-emerald-900' : 'text-slate-900')}>
                            {cat.display_name}
                          </p>
                        </div>
                        {rcFare != null && stdFare != null && Math.round(stdFare) > Math.round(rcFare) ? (
                          <p className="text-[11px] font-semibold text-emerald-600">
                            Save ₹{Math.round(stdFare - rcFare)} vs standard
                          </p>
                        ) : (
                          <p className="text-[11px] font-medium text-slate-400">Discounted return rate</p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          {loading && rcFare == null ? (
                            <div className="w-12 h-5 rounded-lg bg-slate-100 animate-pulse" />
                          ) : rcFare != null ? (
                            <p className={cn('text-[17px] font-black tabular-nums leading-tight',
                              isSel ? 'text-emerald-700' : 'text-slate-900'
                            )}>
                              ₹<AnimatedNumber value={Math.round(rcFare)} />
                            </p>
                          ) : (
                            <p className="text-sm text-slate-400">—</p>
                          )}
                        </div>
                        <div className={cn(
                          'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-150',
                          isSel ? 'border-emerald-500' : 'border-slate-200'
                        )}>
                          {isSel && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                        </div>
                      </div>
                    </button>
                  )
                })
              }
              <div className="mx-4 h-px bg-slate-100 mt-1 mb-1" />
            </div>
          )}

          {/* ── Standard category list ── */}
          {categories.map((cat, i) => {
            const est    = estimates[cat.id]
            const fare   = est?.breakdown.total
            const isSel  = !isReturnCab && selected === cat.id
            const eta    = driverEta[cat.id]
            const noCars = !scheduledFor && etaReady && eta != null && eta.count === 0
            const active = isSel && !noCars

            return (
              <div key={cat.id}>
                <button
                  onClick={() => { if (!noCars) { setSelected(cat.id); setIsReturnCab(false) } }}
                  disabled={noCars}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 transition-colors duration-150 text-left',
                    noCars  ? 'opacity-35 cursor-not-allowed' :
                    active  ? 'bg-violet-50' :
                              'active:bg-slate-50 cursor-pointer'
                  )}
                >
                  <div className={cn(
                    'w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0',
                    active ? 'bg-violet-100' : 'bg-slate-100'
                  )}>
                    <VehicleIcon
                      slug={cat.slug}
                      size={32}
                      color={active ? '#4F46E5' : '#475569'}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className={cn('text-[14px] font-bold leading-tight', active ? 'text-violet-900' : 'text-slate-900')}>
                        {cat.display_name}
                      </p>
                      {est?.surge_multiplier != null && est.surge_multiplier > 1 && (
                        <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-500">
                          <Zap size={9} />{est.surge_multiplier}×
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 mt-0.5">
                      <span className="flex items-center gap-0.5 text-[11px] text-slate-400 font-medium">
                        <Users size={9} strokeWidth={2.5} />{cat.max_passengers} seats
                      </span>
                      {noCars ? (
                        <span className="text-[11px] font-semibold text-red-400">No cars nearby</span>
                      ) : eta != null && eta.etaMin > 0 ? (
                        <span className={cn('flex items-center gap-0.5 text-[11px] font-semibold',
                          active ? 'text-violet-500' : 'text-emerald-600'
                        )}>
                          <Clock size={9} strokeWidth={2.5} />{eta.etaMin} min away
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      {loading && fare == null ? (
                        <div className="w-12 h-5 rounded-lg bg-slate-100 animate-pulse" />
                      ) : fare != null ? (
                        <p className={cn('text-[17px] font-black tabular-nums leading-tight',
                          active ? 'text-violet-900' : 'text-slate-900'
                        )}>
                          ₹<AnimatedNumber value={Math.round(fare)} />
                        </p>
                      ) : (
                        <p className="text-sm text-slate-400">—</p>
                      )}
                    </div>
                    <div className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-150',
                      active ? 'border-violet-500' : 'border-slate-200'
                    )}>
                      {active && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                    </div>
                  </div>
                </button>
                {i < categories.length - 1 && <div className="mx-4 h-px bg-slate-100" />}
              </div>
            )
          })}

          {/* Round trip fare breakdown */}
          {rideType === 'round_trip' && estimates[selected] && tripHours !== undefined && (
            <div
              className="mx-4 mt-1 mb-2 rounded-2xl px-3 py-2.5 space-y-1"
              style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}
            >
              <div className="flex justify-between text-[11px]">
                <span style={{ color: '#6366F1' }}>Base fare</span>
                <span className="font-semibold" style={{ color: '#1E1B4B' }}>₹{Math.round(Number(estimates[selected]!.breakdown.base_fare))}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span style={{ color: '#6366F1' }}>Distance</span>
                <span className="font-semibold" style={{ color: '#1E1B4B' }}>₹{Math.round(Number(estimates[selected]!.breakdown.distance_fare))}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span style={{ color: '#6366F1' }}>Travel time</span>
                <span className="font-semibold" style={{ color: '#1E1B4B' }}>₹{Math.round(Number(estimates[selected]!.breakdown.time_fare))}</span>
              </div>
              {stops.length > 0 && Number(estimates[selected]!.breakdown.stop_fare) > 0 && (
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: '#6366F1' }}>Stops ({stops.length} × ₹{Math.round(Number(estimates[selected]!.breakdown.stop_fare) / stops.length)})</span>
                  <span className="font-semibold" style={{ color: '#1E1B4B' }}>₹{Math.round(Number(estimates[selected]!.breakdown.stop_fare))}</span>
                </div>
              )}
              {Number(estimates[selected]!.breakdown.hour_surcharge) > 0 && (
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: '#6366F1' }}>Waiting ({tripHours}h)</span>
                  <span className="font-semibold" style={{ color: '#1E1B4B' }}>₹{Math.round(Number(estimates[selected]!.breakdown.hour_surcharge))}</span>
                </div>
              )}
              {Number(estimates[selected]!.breakdown.surge_fare) > 0 && (
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: '#F59E0B' }}>Surge ({estimates[selected]!.surge_multiplier}×)</span>
                  <span className="font-semibold" style={{ color: '#0F172A' }}>₹{Math.round(Number(estimates[selected]!.breakdown.surge_fare))}</span>
                </div>
              )}
              <div className="h-px" style={{ background: '#C7D2FE' }} />
              <div className="flex justify-between items-baseline">
                <span className="text-[12px] font-bold" style={{ color: '#0F172A' }}>Total</span>
                <span className="text-[15px] font-black tabular-nums" style={{ color: '#4F46E5' }}>₹{Math.round(Number(estimates[selected]!.breakdown.total))}</span>
              </div>
            </div>
          )}
        </div>

        {/* Book bar */}
        <div
          className="flex-shrink-0 bg-white border-t border-slate-100 px-4 pt-2.5"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                <CreditCard size={14} className="text-slate-600" />
              </div>
              <span className="text-sm font-semibold text-slate-700">Cash</span>
            </div>
            <button className="text-xs font-bold text-violet-600">Change</button>
          </div>
          {bookError && <p className="text-red-500 text-sm text-center mb-2">{bookError}</p>}
          <button
            onClick={handleBook}
            disabled={
              isBooking || loading || selectedFare == null || allUnavailable ||
              (!scheduledFor && !isReturnCab && (driverEta[selected]?.count === 0)) ||
              roundTripMissingHours ||
              (detourPriced && (routingStops || routedDistanceKm == null))
            }
            className="w-full py-4 rounded-2xl text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ background: isBooking ? '#6D28D9' : 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)', minHeight: 52 }}
          >
            {isBooking
              ? 'Booking…'
              : allUnavailable
              ? 'No drivers available'
              : roundTripMissingHours
              ? 'Select duration first'
              : scheduledFor
              ? `Schedule ${selectedCat?.display_name ?? ''} · ${selectedFare != null ? `₹${Math.round(selectedFare)}` : '—'}`
              : `Book ${selectedCat?.display_name ?? ''} · ${selectedFare != null ? `₹${Math.round(selectedFare)}` : '—'}`
            }
          </button>
        </div>
      </div>

      {/* In-city redirect toast */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {redirectToast && (
            <motion.div
              key="redirect-toast"
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: 16, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95 }}
              transition={{ duration: 0.24, ease: EASE }}
              className="fixed left-1/2 z-[999] flex flex-col gap-2 px-5 py-3.5 rounded-2xl text-white overflow-hidden pointer-events-none"
              style={{
                bottom: 'max(84px, calc(env(safe-area-inset-bottom, 0px) + 76px))',
                x: '-50%',
                maxWidth: 'calc(100vw - 32px)',
                background: 'linear-gradient(135deg, #4F46E5 0%, #1E1B4B 100%)',
                boxShadow: '0 8px 32px rgba(79,70,229,0.35), 0 2px 8px rgba(0,0,0,0.2)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <ArrowRightLeft size={15} strokeWidth={2.2} className="flex-shrink-0" />
                <span className="text-[13px] font-semibold">{redirectToast}</span>
              </div>
              <div className="h-[3px] rounded-full bg-white/20 overflow-hidden">
                <motion.div
                  className="h-full bg-white/80 rounded-full"
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: 1.5, ease: 'linear' }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      <AddStopSheet
        open={addStopOpen}
        onClose={() => setAddStopOpen(false)}
        onSelect={(s) => { setAddStopOpen(false); writeStops([...stops, s]) }}
        title={`Add stop ${stops.length + 1}`}
        originLat={originLat}
        originLng={originLng}
      />
    </div>
  )
}

export default function SelectRidePage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center bg-white">
        <OcarSpinner size={32} variant="mono" />
      </div>
    }>
      <SelectRideContent />
    </Suspense>
  )
}
