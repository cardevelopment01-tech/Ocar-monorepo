'use client'

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import { ArrowLeft, Users, Zap, Clock, CreditCard } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { rideApi, type FareEstimate } from '@/lib/ride-api'
import AnimatedNumber from '@/components/ui/AnimatedNumber'

const SelectRideMapScene = dynamic(() => import('@/components/map/SelectRideMapScene'), { ssr: false })

type Category = { id: number; slug: string; display_name: string; max_passengers: number }

const FALLBACK_CATEGORIES: Category[] = [
  { id: 1, slug: 'hatchback', display_name: 'Hatchback', max_passengers: 4 },
  { id: 2, slug: 'sedan',     display_name: 'Sedan',     max_passengers: 4 },
  { id: 3, slug: 'suv',       display_name: 'SUV',       max_passengers: 6 },
  { id: 4, slug: 'luxury',    display_name: 'Luxury',    max_passengers: 4 },
]

// Car emoji per category — more evocative than a generic lucide icon
const CAT_EMOJI: Record<string, string> = {
  hatchback: '🚗',
  sedan:     '🚖',
  suv:       '🚙',
  luxury:    '🏎️',
  van:       '🚐',
}

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
        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 z-10 w-9 h-9 bg-white rounded-full shadow-md flex items-center justify-center"
        >
          <ArrowLeft size={18} className="text-slate-800" />
        </button>
      </div>

      {/* ── Sheet ── */}
      <div
        className="flex-1 flex flex-col bg-white min-h-0"
        style={{ boxShadow: '0 -8px 32px rgba(0,0,0,0.10)', borderRadius: '20px 20px 0 0', marginTop: -8, position: 'relative', zIndex: 2 }}
      >
        {/* Route summary */}
        <div className="flex-shrink-0 px-4 pt-4 pb-3">
          <div className="flex items-stretch gap-3 bg-slate-50 rounded-2xl px-4 py-3 border border-slate-100">
            {/* Visual connector */}
            <div className="flex flex-col items-center gap-0 pt-[3px] pb-[3px]">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" style={{ boxShadow: '0 0 0 3px rgba(16,185,129,0.15)' }} />
              <div className="w-px flex-1 my-1.5 bg-slate-200" />
              <div className="w-2.5 h-2.5 rounded-[3px] bg-slate-800 flex-shrink-0" />
            </div>
            {/* Addresses */}
            <div className="flex-1 min-w-0 flex flex-col gap-2.5">
              <p className="text-xs font-semibold text-slate-500 truncate leading-none">{originAddress}</p>
              <p className="text-xs font-bold text-slate-800 truncate leading-none">{destinationAddress}</p>
            </div>
            {/* Distance + time */}
            <div className="flex flex-col items-end justify-center gap-0.5 flex-shrink-0 pl-2 border-l border-slate-200">
              <span className="text-sm font-black text-slate-800 tabular-nums">{distanceKm} km</span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{Math.round(durationMin)} min</span>
            </div>
          </div>
        </div>

        {/* No drivers banner */}
        {allUnavailable && (
          <div className="mx-4 mb-2 flex items-center gap-2.5 rounded-2xl px-4 py-3 bg-amber-50 border border-amber-200">
            <span className="text-lg flex-shrink-0">😴</span>
            <div>
              <p className="text-[13px] font-bold text-amber-800">No drivers nearby right now</p>
              <p className="text-[11px] text-amber-600 mt-0.5">Try again in a few minutes — drivers come online throughout the day</p>
            </div>
          </div>
        )}

        {/* Ride cards */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-3 space-y-2">
          {categories.map(cat => {
            const est    = estimates[cat.id]
            const fare   = est?.breakdown.total
            const isSel  = selected === cat.id
            const eta    = driverEta[cat.id]
            const noCars = etaReady && eta != null && eta.count === 0
            const emoji  = CAT_EMOJI[cat.slug] ?? '🚗'
            // Only apply dark (inverted) styling when the card is both selected AND available
            const dark   = isSel && !noCars

            return (
              <button
                key={cat.id}
                onClick={() => !noCars && setSelected(cat.id)}
                disabled={noCars}
                className={cn(
                  'w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-150 active:scale-[0.98]',
                  noCars ? 'bg-slate-50 opacity-40 cursor-not-allowed' :
                  dark   ? 'bg-slate-900 cursor-pointer' :
                           'bg-slate-50 cursor-pointer active:bg-slate-100'
                )}
                style={dark ? { boxShadow: '0 4px 20px rgba(15,15,35,0.22)' } : undefined}
              >
                {/* Car emoji */}
                <div className={cn(
                  'w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-3xl select-none',
                  dark ? 'bg-white/10' : 'bg-white border border-slate-100'
                )}>
                  {emoji}
                </div>

                {/* Name + meta */}
                <div className="flex-1 text-left min-w-0">
                  <p className={cn('text-[15px] font-bold leading-tight', dark ? 'text-white' : 'text-slate-900')}>
                    {cat.display_name}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={cn('flex items-center gap-1 text-[11px] font-semibold', dark ? 'text-white/50' : 'text-slate-400')}>
                      <Users size={9} strokeWidth={2.5} />{cat.max_passengers} seats
                    </span>
                    {noCars ? (
                      <span className="text-[11px] font-bold text-red-400">No cars nearby</span>
                    ) : eta != null && eta.etaMin > 0 ? (
                      <span className={cn(
                        'flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full',
                        dark ? 'bg-emerald-400/20 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                      )}>
                        <Clock size={9} strokeWidth={2.5} />{eta.etaMin} min
                      </span>
                    ) : null}
                    {est?.surge_multiplier != null && est.surge_multiplier > 1 && (
                      <span className={cn('flex items-center gap-0.5 text-[11px] font-bold', dark ? 'text-amber-300' : 'text-amber-600')}>
                        <Zap size={9} />{est.surge_multiplier}×
                      </span>
                    )}
                  </div>
                </div>

                {/* Price */}
                <div className="text-right flex-shrink-0 min-w-[64px]">
                  {loading && !fare ? (
                    <div className={cn('w-14 h-5 rounded-lg animate-pulse', dark ? 'bg-white/10' : 'bg-slate-200')} />
                  ) : fare != null ? (
                    <p className={cn('text-xl font-black tabular-nums', dark ? 'text-white' : 'text-slate-900')}>
                      ₹<AnimatedNumber value={Math.round(fare)} />
                    </p>
                  ) : (
                    <p className={cn('text-sm', dark ? 'text-white/40' : 'text-slate-400')}>—</p>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Fixed book bar */}
        <div
          className="flex-shrink-0 bg-white border-t border-slate-100 px-4 pt-3"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        >
          {/* Payment row */}
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                <CreditCard size={14} className="text-slate-600" />
              </div>
              <span className="text-sm font-semibold text-slate-700">Cash</span>
            </div>
            <button className="text-xs text-primary font-bold">Change</button>
          </div>
          {bookError && (
            <p className="text-red-500 text-sm text-center mb-2">{bookError}</p>
          )}
          <button
            onClick={handleBook}
            disabled={isBooking || loading || selectedFare == null || allUnavailable || (driverEta[selected]?.count === 0)}
            className="w-full py-4 rounded-2xl text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ background: isBooking ? '#374151' : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', minHeight: 52 }}
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
