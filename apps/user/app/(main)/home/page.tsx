'use client'

import { MapPin, Search, Bell, User } from 'lucide-react'
import dynamic from 'next/dynamic'
import OcarLogo from '@/components/ui/OcarLogo'
import { mockPickup, mockNearbyDrivers } from '@/lib/mock-data'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

const HomeMapScene = dynamic(() => import('@/components/map/HomeMapScene'), { ssr: false })

const SAVED_PLACES = [
  { icon: '🏠', label: 'Home', address: 'Sahid Nagar, Bhubaneswar' },
  { icon: '💼', label: 'Work', address: 'Infocity, Chandrasekharpur' },
  { icon: '🛒', label: 'DMart', address: 'Patia, Bhubaneswar' },
]

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function HomePage() {
  const router = useRouter()
  const { user } = useAuth()
  const firstName = user?.name?.split(' ')[0] ?? 'there'

  return (
    <div className="relative w-full h-screen overflow-hidden">

      {/* MAP — bottom of the stack */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <HomeMapScene
          center={[mockPickup.lat, mockPickup.lng]}
          pickupPos={[mockPickup.lat, mockPickup.lng]}
          drivers={mockNearbyDrivers}
        />
      </div>

      {/* TOP BAR — floats above map */}
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

      {/* BOTTOM SEARCH SHEET — floats above map, above nav */}
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
          onClick={() => router.push('/search')}
          className="w-full bg-background rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left"
        >
          <Search size={18} className="text-text-muted flex-shrink-0" />
          <span className="text-text-muted text-sm">Search destination</span>
        </button>

        <div className="mt-4">
          {SAVED_PLACES.map((place) => (
            <button
              key={place.label}
              onClick={() => router.push('/search')}
              className="w-full flex items-center gap-3 py-3 border-b border-border last:border-0"
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
