'use client'

import { useState } from 'react'
import { ArrowLeft, Users, Zap, Car } from 'lucide-react'
import dynamic from 'next/dynamic'
import { mockPickup, mockDrop, mockRoute, mockVehicles } from '@/lib/mock-data'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

const SelectRideMapScene = dynamic(() => import('@/components/map/SelectRideMapScene'), { ssr: false })

export default function SelectRidePage() {
  const router = useRouter()
  const [selected, setSelected] = useState(mockVehicles[0].id)
  const center: [number, number] = [
    (mockPickup.lat + mockDrop.lat) / 2,
    (mockPickup.lng + mockDrop.lng) / 2,
  ]

  const selectedVehicle = mockVehicles.find(v => v.id === selected)!

  return (
    <div className="h-full flex flex-col">
      {/* Map top 45% */}
      <div className="relative" style={{ height: '45%' }}>
        <SelectRideMapScene
          center={center}
          pickupPos={[mockPickup.lat, mockPickup.lng]}
          dropPos={[mockDrop.lat, mockDrop.lng]}
          route={mockRoute}
        />

        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 z-10 w-9 h-9 bg-surface rounded-full shadow-card flex items-center justify-center"
        >
          <ArrowLeft size={18} className="text-text-primary" />
        </button>

        {/* Route info */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-surface rounded-full shadow-card px-4 py-2 flex items-center gap-3">
          <span className="text-xs font-semibold text-text-primary">6.4 km</span>
          <div className="w-px h-4 bg-border" />
          <span className="text-xs text-text-muted">~18 min</span>
        </div>
      </div>

      {/* Bottom sheet */}
      <div className="flex-1 bg-surface rounded-t-3xl -mt-3 shadow-sheet overflow-y-auto">
        <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 mb-4" />
        <div className="px-4 pb-4">
          <h2 className="font-bold text-text-primary text-lg mb-4 pl-1">Choose a ride</h2>

          <div className="space-y-2 mb-6">
            {mockVehicles.map(v => (
              <button
                key={v.id}
                onClick={() => setSelected(v.id)}
                className={cn(
                  'w-full flex items-center gap-3 p-4 rounded-2xl border-2 transition-colors',
                  selected === v.id
                    ? 'border-primary bg-primary-subtle'
                    : 'border-transparent bg-background'
                )}
              >
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                  selected === v.id ? 'bg-primary' : 'bg-background'
                )}>
                  <Car size={20} className={selected === v.id ? 'text-white' : 'text-text-muted'} />
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-text-primary">{v.name}</p>
                    {v.isEco && (
                      <span className="flex items-center gap-0.5 text-status-success text-xs font-medium">
                        <Zap size={10} /> Eco
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-text-muted mt-0.5">
                    <Users size={11} />
                    <span>{v.capacity} · {v.eta} away</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-text-primary">₹{v.price}</p>
                  {v.originalPrice && (
                    <p className="text-xs text-text-muted line-through">₹{v.originalPrice}</p>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Payment row */}
          <div className="flex items-center justify-between bg-background rounded-2xl px-4 py-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">💳</span>
              <span className="text-sm font-medium text-text-primary">Cash</span>
            </div>
            <button className="text-xs text-primary font-semibold">Change</button>
          </div>

          <button
            onClick={() => router.push('/ride/mock-ride-001')}
            className="btn-primary w-full"
          >
            Book {selectedVehicle.name} · ₹{selectedVehicle.price}
          </button>
        </div>
      </div>
    </div>
  )
}
