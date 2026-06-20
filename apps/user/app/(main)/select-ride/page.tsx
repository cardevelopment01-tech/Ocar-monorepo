'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Users, Zap, Car, Truck, CreditCard } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { rideApi, type FareEstimate } from '@/lib/ride-api'
import AnimatedNumber from '@/components/ui/AnimatedNumber'

const SelectRideMapScene = dynamic(() => import('@/components/map/SelectRideMapScene'), { ssr: false })

type Category = { id: number; slug: string; display_name: string; max_passengers: number }

// Fallback category list — avoids an extra API round-trip
const FALLBACK_CATEGORIES: Category[] = [
  { id: 1, slug: 'hatchback', display_name: 'Hatchback', max_passengers: 4 },
  { id: 2, slug: 'sedan',     display_name: 'Sedan',     max_passengers: 4 },
  { id: 3, slug: 'suv',       display_name: 'SUV',       max_passengers: 6 },
  { id: 4, slug: 'luxury',    display_name: 'Luxury',    max_passengers: 4 },
]

const CATEGORY_ICON: Record<string, LucideIcon> = {
  hatchback: Car,
  sedan:     Car,
  suv:       Truck,
  luxury:    Car,
  van:       Truck,
}

function SelectRideContent() {
  const router    = useRouter()
  const sp        = useSearchParams()

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

  const [categories]     = useState<Category[]>(FALLBACK_CATEGORIES)
  const [estimates,      setEstimates]      = useState<Record<number, FareEstimate>>({})
  const [loading,        setLoading]        = useState(true)
  const [selected,       setSelected]       = useState(2)
  const [isBooking,      setIsBooking]      = useState(false)
  const [bookError,      setBookError]      = useState<string | null>(null)
  const [nearbyDrivers,  setNearbyDrivers]  = useState<Array<{ driver_id: string; lat: number; lng: number; category_id: number }>>([])

  useEffect(() => {
    const fetch = async () => {
      try { setNearbyDrivers(await rideApi.getNearbyDrivers(originLat, originLng)) } catch {}
    }
    void fetch()
    const id = setInterval(fetch, 8000)
    return () => clearInterval(id)
  }, [originLat, originLng])

  const center: [number, number] = [(originLat + destinationLat) / 2, (originLng + destinationLng) / 2]

  const loadEstimates = useCallback(async () => {
    setLoading(true)
    const results: Record<number, FareEstimate> = {}
    await Promise.allSettled(
      categories.map(async cat => {
        try {
          results[cat.id] = await rideApi.getEstimate({
            categoryId:   cat.id,
            rideType:     'one_way',
            distanceKm,
            durationMin,
            originCityId,
          })
        } catch { /* skip this category */ }
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
        categoryId:          selected,
        rideType:            'one_way',
        originLat,
        originLng,
        originAddress,
        destinationLat,
        destinationLng,
        destinationAddress,
        distanceKm,
        durationMin,
        originCityId,
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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Map */}
      <div className="relative" style={{ height: '38%' }}>
        <SelectRideMapScene
          center={center}
          pickupPos={[originLat, originLng]}
          dropPos={[destinationLat, destinationLng]}
          encodedPolyline={encodedPolyline}
          nearbyDrivers={nearbyDrivers}
        />
        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 z-10 w-9 h-9 bg-surface rounded-full shadow-card flex items-center justify-center"
        >
          <ArrowLeft size={18} className="text-text-primary" />
        </button>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-surface rounded-full shadow-card px-4 py-2 flex items-center gap-3">
          <span className="text-xs font-semibold text-text-primary">{distanceKm} km</span>
          <div className="w-px h-4 bg-border" />
          <span className="text-xs text-text-muted">~{Math.round(durationMin)} min</span>
        </div>
      </div>

      {/* Bottom sheet */}
      <div className="flex-1 bg-surface rounded-t-3xl -mt-3 shadow-sheet overflow-y-auto">
        <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 mb-4" />
        <div className="px-4 pb-24">
          <h2 className="font-bold text-text-primary text-lg mb-4 pl-1">Choose a ride</h2>

          <div className="space-y-2 mb-6">
            {categories.map(cat => {
              const est  = estimates[cat.id]
              const fare = est?.breakdown.total
              const isSelected = selected === cat.id
              const CatIcon = CATEGORY_ICON[cat.slug] ?? Car

              return (
                <button
                  key={cat.id}
                  onClick={() => setSelected(cat.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-4 rounded-2xl border-2 transition-all duration-150 active:scale-[0.98] cursor-pointer',
                    isSelected ? 'border-primary bg-primary-subtle' : 'border-transparent bg-background'
                  )}
                >
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all',
                    isSelected ? 'bg-gradient-primary shadow-button' : 'bg-primary-subtle'
                  )}>
                    <CatIcon size={20} className={isSelected ? 'text-white' : 'text-primary'} />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-bold text-text-primary">{cat.display_name}</p>
                    <div className="flex items-center gap-1 text-xs text-text-muted mt-0.5">
                      <Users size={11} />
                      <span>{cat.max_passengers} seats</span>
                      {est?.surge_multiplier != null && est.surge_multiplier > 1 && (
                        <span className="ml-1 flex items-center gap-0.5 text-status-warning">
                          <Zap size={10} /> {est.surge_multiplier}×
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right min-w-[56px]">
                    {loading && !fare ? (
                      <div className="w-12 h-4 bg-background rounded animate-pulse" />
                    ) : fare != null ? (
                      <p className={cn('font-bold', isSelected ? 'text-gradient-primary' : 'text-text-primary')}>₹<AnimatedNumber value={fare} /></p>
                    ) : (
                      <p className="text-xs text-text-muted">—</p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <div
            className="flex items-center justify-between rounded-2xl px-4 py-3 mb-4"
            style={{
              background: 'rgba(79,70,229,0.04)',
              border: '1px solid rgba(79,70,229,0.10)',
            }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(79,70,229,0.10)' }}
              >
                <CreditCard size={14} className="text-primary" />
              </div>
              <span className="text-sm font-semibold text-text-primary">Cash</span>
            </div>
            <button className="text-xs text-primary font-semibold cursor-pointer">Change</button>
          </div>

          {bookError && (
            <p className="text-status-error text-sm text-center mb-3">{bookError}</p>
          )}

          <button
            onClick={handleBook}
            disabled={isBooking || loading || selectedFare == null}
            className="btn-primary w-full"
          >
            {isBooking
              ? 'Booking…'
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
      <div className="h-full flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    }>
      <SelectRideContent />
    </Suspense>
  )
}
