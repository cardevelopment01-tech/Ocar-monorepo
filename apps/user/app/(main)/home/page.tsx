'use client'

import { useRef, useEffect, useState, useMemo } from 'react'
import { MapPin, Search, Bell, User } from 'lucide-react'
import dynamic from 'next/dynamic'
import OcarLogo from '@/components/ui/OcarLogo'
import { mockPickup } from '@/lib/mock-data'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

const HomeMapScene = dynamic(() => import('@/components/map/HomeMapScene'), { ssr: false })

// Mock nearby driver positions (Phase 1 — real positions come in M11)
function getMockDrivers(baseLat: number, baseLng: number) {
  return [
    { id: 'd1', lat: baseLat + 0.009,  lng: baseLng - 0.007, heading: 45  },
    { id: 'd2', lat: baseLat - 0.005,  lng: baseLng + 0.011, heading: 180 },
    { id: 'd3', lat: baseLat + 0.012,  lng: baseLng + 0.006, heading: 270 },
  ]
}

const SAVED_PLACES = [
  { icon: '🏠', label: 'Home',  address: 'Sahid Nagar, Bhubaneswar',     lat: 20.2929, lng: 85.8363 },
  { icon: '💼', label: 'Work',  address: 'Infocity, Chandrasekharpur',    lat: 20.3506, lng: 85.8110 },
  { icon: '🛒', label: 'DMart', address: 'Patia, Bhubaneswar',            lat: 20.3554, lng: 85.8207 },
]

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function HomePage() {
  const router    = useRouter()
  const { user }  = useAuth()
  const firstName = user?.name?.split(' ')[0] ?? 'there'

  const [originLat,  setOriginLat]  = useState(mockPickup.lat)
  const [originLng,  setOriginLng]  = useState(mockPickup.lng)
  const [originAddr, setOriginAddr] = useState('Current Location')
  const locationFetched = useRef(false)

  // Try GPS once on mount
  useEffect(() => {
    if (locationFetched.current || !navigator.geolocation) return
    locationFetched.current = true
    navigator.geolocation.getCurrentPosition(
      pos => {
        setOriginLat(pos.coords.latitude)
        setOriginLng(pos.coords.longitude)
        setOriginAddr('Current Location')
      },
      () => { /* use Bhubaneswar default */ },
      { enableHighAccuracy: false, timeout: 8000 }
    )
  }, [])

  const mockDrivers = useMemo(() => getMockDrivers(originLat, originLng), [originLat, originLng])

  function goToSearch(destLabel?: string, destLat?: number, destLng?: number) {
    const params = new URLSearchParams({
      originLat:    originLat.toString(),
      originLng:    originLng.toString(),
      originAddress: originAddr,
    })
    if (destLabel && destLat != null && destLng != null) {
      // Pre-fill destination for saved places
      const { haversineKm } = {
        haversineKm: (la1: number, lo1: number, la2: number, lo2: number) => {
          const R = 6371
          const dLa = (la2 - la1) * Math.PI / 180
          const dLo = (lo2 - lo1) * Math.PI / 180
          const a = Math.sin(dLa/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2
          return R * 2 * Math.asin(Math.sqrt(a))
        }
      }
      const straight = haversineKm(originLat, originLng, destLat, destLng)
      const distanceKm  = Math.round(straight * 1.3 * 10) / 10
      const durationMin = Math.round(distanceKm / 0.5)
      const sp = new URLSearchParams({
        originLat:           originLat.toString(),
        originLng:           originLng.toString(),
        originAddress:       originAddr,
        destinationLat:      destLat.toString(),
        destinationLng:      destLng.toString(),
        destinationAddress:  destLabel,
        distanceKm:          distanceKm.toString(),
        durationMin:         durationMin.toString(),
        originCityId:        '1',
      })
      router.push(`/select-ride?${sp.toString()}`)
      return
    }
    router.push(`/search?${params.toString()}`)
  }

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* MAP */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <HomeMapScene
          center={[originLat, originLng]}
          pickupPos={[originLat, originLng]}
          drivers={mockDrivers}
        />
      </div>

      {/* TOP BAR */}
      <div
        className="absolute top-0 left-0 right-0 px-4 pt-12 pb-3 flex items-center justify-between"
        style={{ zIndex: 10 }}
      >
        <div className="backdrop-blur-sm bg-white/80 rounded-2xl px-4 py-2 shadow-card">
          <OcarLogo size="sm" />
        </div>
        <div className="flex gap-2">
          <button className="w-10 h-10 bg-white/80 backdrop-blur-sm rounded-full shadow-card flex items-center justify-center">
            <Bell size={18} className="text-text-secondary" />
          </button>
          <button className="w-10 h-10 bg-white/80 backdrop-blur-sm rounded-full shadow-card flex items-center justify-center">
            <User size={18} className="text-text-secondary" />
          </button>
        </div>
      </div>

      {/* BOTTOM SEARCH SHEET */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl shadow-sheet px-4 pt-3"
        style={{
          zIndex: 10,
          paddingBottom: 'calc(70px + env(safe-area-inset-bottom))',
        }}
      >
        <div className="mx-auto mt-3 mb-4 w-12 h-1.5 rounded-full bg-slate-200" />

        <p className="text-xs text-text-muted mb-0.5">{getGreeting()}, {firstName} 👋</p>
        <p className="text-base font-semibold text-text-primary mb-3">Where to?</p>

        <button
          onClick={() => goToSearch()}
          className="w-full bg-background rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left active:scale-[0.98] transition-transform duration-100"
        >
          <Search size={18} className="text-text-muted flex-shrink-0" />
          <span className="text-text-muted text-sm">Search destination</span>
        </button>

        <div className="mt-4">
          {SAVED_PLACES.map((place) => (
            <button
              key={place.label}
              onClick={() => goToSearch(place.address, place.lat, place.lng)}
              className="w-full flex items-center gap-3 py-3 border-b border-border last:border-0 active:scale-[0.98] transition-transform duration-100"
            >
              <div className="w-9 h-9 bg-background rounded-xl flex items-center justify-center text-base">
                {place.icon}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold text-text-primary">{place.label}</p>
                <p className="text-xs text-text-muted truncate">{place.address}</p>
              </div>
              <MapPin size={14} className="text-text-muted flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
