'use client'

import { Suspense, useState, useEffect } from 'react'
import { ArrowLeft, MapPin, Clock, Navigation, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

// Straight-line distance using Haversine formula
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

// Bhubaneswar default origin
const DEFAULT_ORIGIN = { lat: 20.2961, lng: 85.8245, address: 'Bhubaneswar' }

// Quick-select destinations
const DESTINATIONS = [
  { icon: '✈️', label: 'Bhubaneswar Airport', address: 'Bhubaneswar Airport, Bhubaneswar', lat: 20.2444, lng: 85.8178 },
  { icon: '🚉', label: 'Bhubaneswar Railway Station', address: 'Bhubaneswar Junction', lat: 20.2663, lng: 85.8424 },
  { icon: '🏥', label: 'AIIMS Bhubaneswar', address: 'AIIMS, Sijua, Bhubaneswar', lat: 20.1823, lng: 85.7698 },
  { icon: '🛍️', label: 'Esplanade One', address: 'Rasulgarh, Bhubaneswar', lat: 20.2877, lng: 85.8508 },
  { icon: '🎓', label: 'KIIT University', address: 'Patia, Bhubaneswar', lat: 20.3560, lng: 85.8181 },
  { icon: '🏙️', label: 'Cuttack City', address: 'Cuttack, Odisha', lat: 20.4625, lng: 85.8830 },
]

function SearchContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Origin comes from home page via URL params, or we fall back to default/GPS
  const [originLat,     setOriginLat]     = useState(() => parseFloat(searchParams.get('originLat') ?? '') || DEFAULT_ORIGIN.lat)
  const [originLng,     setOriginLng]     = useState(() => parseFloat(searchParams.get('originLng') ?? '') || DEFAULT_ORIGIN.lng)
  const [originAddress, setOriginAddress] = useState(() => searchParams.get('originAddress') ?? DEFAULT_ORIGIN.address)
  const [dropText, setDropText] = useState('')

  // Try to get GPS on mount if no origin was passed
  useEffect(() => {
    if (searchParams.get('originLat')) return
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        setOriginLat(pos.coords.latitude)
        setOriginLng(pos.coords.longitude)
        setOriginAddress('Current Location')
      },
      () => { /* keep defaults */ },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }, [searchParams])

  function selectDestination(dest: typeof DESTINATIONS[0]) {
    const straightKm = haversineKm(originLat, originLng, dest.lat, dest.lng)
    const distanceKm = Math.round(straightKm * 1.3 * 10) / 10
    const durationMin = Math.round(distanceKm / 0.5)

    const params = new URLSearchParams({
      originLat:           originLat.toString(),
      originLng:           originLng.toString(),
      originAddress,
      destinationLat:      dest.lat.toString(),
      destinationLng:      dest.lng.toString(),
      destinationAddress:  dest.address,
      distanceKm:          distanceKm.toString(),
      durationMin:         durationMin.toString(),
      originCityId:        '1',
    })
    router.push(`/select-ride?${params.toString()}`)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-surface shadow-card px-4 pt-safe-top pb-4">
        <div className="flex items-center gap-3 pt-3 mb-4">
          <button onClick={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={22} className="text-text-primary" />
          </button>
          <span className="font-semibold text-text-primary">Where to?</span>
        </div>

        {/* Origin (read-only) */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-background mb-2">
          <div className="w-2.5 h-2.5 rounded-full bg-primary flex-shrink-0" />
          <span className="flex-1 text-sm text-text-primary truncate">{originAddress}</span>
          <Navigation size={14} className="text-primary flex-shrink-0" />
        </div>

        {/* Drop search (cosmetic — we use the list below) */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-primary-subtle ring-2 ring-primary">
          <div className="w-2.5 h-2.5 rounded-full bg-text-primary flex-shrink-0" />
          <input
            value={dropText}
            onChange={e => setDropText(e.target.value)}
            placeholder="Select a destination below"
            className="flex-1 bg-transparent text-sm text-text-primary outline-none"
            autoFocus
          />
          {dropText && (
            <button onClick={() => setDropText('')}>
              <X size={14} className="text-text-muted" />
            </button>
          )}
        </div>
      </div>

      {/* Destinations */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Popular destinations</p>
        {DESTINATIONS.filter(d =>
          !dropText || d.label.toLowerCase().includes(dropText.toLowerCase())
        ).map(d => (
          <button
            key={d.label}
            onClick={() => selectDestination(d)}
            className="w-full flex items-center gap-3 py-3 border-b border-border last:border-0"
          >
            <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center text-lg shadow-card flex-shrink-0">
              {d.icon}
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold text-text-primary">{d.label}</p>
              <p className="text-xs text-text-muted truncate">{d.address}</p>
            </div>
            <MapPin size={14} className="text-text-muted flex-shrink-0" />
          </button>
        ))}
        {DESTINATIONS.filter(d =>
          !dropText || d.label.toLowerCase().includes(dropText.toLowerCase())
        ).length === 0 && (
          <p className="text-center text-text-muted text-sm py-8">
            No results — try a different name
          </p>
        )}

        {/* Recent (static for now) */}
        {!dropText && (
          <>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mt-5 mb-3">Recent</p>
            {[
              { icon: Clock, label: 'KIIT University, Patia', sub: '3.2 km' },
              { icon: Clock, label: 'Esplanade One Mall', sub: '5.1 km' },
            ].map(p => (
              <button
                key={p.label}
                onClick={() => {
                  const dest = DESTINATIONS.find(d => d.label.includes('KIIT') || d.label.includes('Esplanade'))
                  if (dest) selectDestination(dest)
                }}
                className="w-full flex items-center gap-3 py-3 border-b border-border last:border-0"
              >
                <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center shadow-card flex-shrink-0">
                  <p.icon size={18} className="text-text-muted" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold text-text-primary">{p.label}</p>
                  <p className="text-xs text-text-muted">{p.sub}</p>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>}>
      <SearchContent />
    </Suspense>
  )
}
