'use client'

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import { ArrowLeft, ChevronRight, Users, Zap, Clock, CreditCard } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { rideApi, type FareEstimate } from '@/lib/ride-api'
import AnimatedNumber from '@/components/ui/AnimatedNumber'
import { VehicleIcon } from '@/components/ui/VehicleIcon'

const SelectRideMapScene = dynamic(() => import('@/components/map/SelectRideMapScene'), { ssr: false })

type Category = { id: number; slug: string; display_name: string; max_passengers: number }

const FALLBACK_CATEGORIES: Category[] = [
  { id: 1, slug: 'hatchback', display_name: 'Hatchback', max_passengers: 4 },
  { id: 2, slug: 'sedan',     display_name: 'Sedan',     max_passengers: 4 },
  { id: 3, slug: 'suv',       display_name: 'SUV',       max_passengers: 6 },
  { id: 4, slug: 'luxury',    display_name: 'Luxury',    max_passengers: 4 },
]

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

  const originLat          = parseFloat(sp.get('originLat') ?? '20.2961')
  const originLng          = parseFloat(sp.get('originLng') ?? '85.8245')
  const originAddress      = sp.get('originAddress') ?? 'Pickup'
  const destinationLat     = parseFloat(sp.get('destinationLat') ?? '20.2726')
  const destinationLng     = parseFloat(sp.get('destinationLng') ?? '85.8385')
  const destinationAddress = sp.get('destinationAddress') ?? 'Destination'
  const distanceKm         = parseFloat(sp.get('distanceKm') ?? '10')
  const durationMin        = parseFloat(sp.get('durationMin') ?? '20')
  const originCityId       = parseInt(sp.get('originCityId') ?? '1', 10)
  const encodedPolyline    = sp.get('polyline') ?? undefined

  const [categories]    = useState<Category[]>(FALLBACK_CATEGORIES)
  const [estimates,     setEstimates]     = useState<Record<number, FareEstimate>>({})
  const [loading,       setLoading]       = useState(true)
  const [selected,      setSelected]      = useState(2)
  const [isBooking,     setIsBooking]     = useState(false)
  const [etaReady,      setEtaReady]      = useState(false)
  const [bookError,     setBookError]     = useState<string | null>(null)
  const [nearbyDrivers, setNearbyDrivers] = useState<Array<{ driver_id: string; lat: number; lng: number; category_id: number }>>([])

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
    await Promise.allSettled(
      categories.map(async cat => {
        try {
          results[cat.id] = await rideApi.getEstimate({
            categoryId: cat.id, rideType: 'one_way',
            distanceKm, durationMin, originCityId,
          })
        } catch {}
      })
    )
    setEstimates(results)
    setLoading(false)
  }, [categories, distanceKm, durationMin, originCityId])

  useEffect(() => { void loadEstimates() }, [loadEstimates])

  const handleBook = async () => {
    setIsBooking(true)
    setBookError(null)
    try {
      const result = await rideApi.createBooking({
        categoryId: selected, rideType: 'one_way',
        originLat, originLng, originAddress,
        destinationLat, destinationLng, destinationAddress,
        distanceKm, durationMin, originCityId,
      })
      router.push(`/ride/${result.rideId}`)
    } catch {
      setBookError('Booking failed. Please try again.')
    } finally {
      setIsBooking(false)
    }
  }

  const selectedCat    = categories.find(c => c.id === selected)!
  const selectedFare   = estimates[selected]?.breakdown.total
  const allUnavailable = etaReady && categories.every(c => (driverEta[c.id]?.count ?? 0) === 0)

  function goBackToSearch(focus: 'origin' | 'destination') {
    const params = new URLSearchParams({
      originLat: String(originLat), originLng: String(originLng), originAddress,
      destinationLat: String(destinationLat), destinationLng: String(destinationLng), destinationAddress,
      focus,
    })
    router.push(`/search?${params.toString()}`)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">

      {/* ── Map ── */}
      <div className="relative flex-shrink-0" style={{ height: '42%' }}>
        <SelectRideMapScene
          center={center}
          pickupPos={[originLat, originLng]}
          dropPos={[destinationLat, destinationLng]}
          encodedPolyline={encodedPolyline}
          nearbyDrivers={nearbyDrivers}
        />
        {/* Header bar — standalone back + address pill, both h-10 */}
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
        style={{ boxShadow: '0 -4px 24px rgba(0,0,0,0.08)', borderRadius: '20px 20px 0 0', marginTop: -8, position: 'relative', zIndex: 2 }}
      >
        {/* Handle + header */}
        <div className="flex-shrink-0 px-5 pt-3 pb-2">
          <div className="w-9 h-1 rounded-full bg-slate-200 mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-bold text-slate-900">Choose a ride</p>
            <span className="text-[12px] font-semibold text-slate-400 tabular-nums">
              {distanceKm} km · {Math.round(durationMin)} min
            </span>
          </div>
        </div>

        {/* No drivers banner */}
        {allUnavailable && (
          <div className="mx-4 mb-1 flex items-center gap-2 rounded-2xl px-4 py-2.5 bg-amber-50 border border-amber-200">
            <Clock size={14} className="text-amber-600 flex-shrink-0" />
            <p className="text-[12px] font-semibold text-amber-800">No drivers nearby. Try again in a few minutes.</p>
          </div>
        )}

        {/* Ride list — thin rows with dividers */}
        <div className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
          {categories.map((cat, i) => {
            const est    = estimates[cat.id]
            const fare   = est?.breakdown.total
            const isSel  = selected === cat.id
            const eta    = driverEta[cat.id]
            const noCars = etaReady && eta != null && eta.count === 0
            const active = isSel && !noCars

            return (
              <div key={cat.id}>
                <button
                  onClick={() => !noCars && setSelected(cat.id)}
                  disabled={noCars}
                  className={cn(
                    'w-full flex items-center gap-3 px-5 py-3.5 transition-colors duration-150 text-left',
                    noCars  ? 'opacity-35 cursor-not-allowed' :
                    active  ? 'bg-violet-50' :
                              'active:bg-slate-50 cursor-pointer'
                  )}
                >
                  {/* Vehicle icon */}
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

                  {/* Name + meta */}
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

                  {/* Price + radio */}
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
                {i < categories.length - 1 && <div className="mx-5 h-px bg-slate-100" />}
              </div>
            )
          })}
        </div>

        {/* Book bar */}
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
          {bookError && <p className="text-red-500 text-sm text-center mb-2">{bookError}</p>}
          <button
            onClick={handleBook}
            disabled={isBooking || loading || selectedFare == null || allUnavailable || (driverEta[selected]?.count === 0)}
            className="w-full py-4 rounded-2xl text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ background: isBooking ? '#6D28D9' : 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)', minHeight: 52 }}
          >
            {isBooking
              ? 'Booking…'
              : allUnavailable
              ? 'No drivers available'
              : `Book ${selectedCat?.display_name ?? ''} · ${selectedFare != null ? `₹${Math.round(selectedFare)}` : '—'}`
            }
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SelectRidePage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center bg-white">
        <div className="w-8 h-8 rounded-full border-[3px] border-slate-800 border-t-transparent animate-spin" />
      </div>
    }>
      <SelectRideContent />
    </Suspense>
  )
}
