'use client'

import { useState } from 'react'
import { Star, MapPin, Clock } from 'lucide-react'
import { mockRideHistory } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Tab = 'all' | 'completed' | 'cancelled'

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>('all')

  const filtered = tab === 'all'
    ? mockRideHistory
    : mockRideHistory.filter(r => r.status === tab)

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-surface px-4 pt-safe-top pb-0 shadow-card sticky top-0 z-10">
        <h1 className="text-xl font-bold text-text-primary pt-5 pb-3">Ride History</h1>

        {/* Tabs */}
        <div className="flex gap-1">
          {(['all', 'completed', 'cancelled'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors',
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="px-4 pt-4 space-y-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <Clock size={40} className="mb-3 opacity-30" />
            <p className="text-sm">No rides found</p>
          </div>
        ) : (
          filtered.map(ride => (
            <div key={ride.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className={cn(
                    'text-xs font-semibold px-2.5 py-1 rounded-full',
                    ride.status === 'completed' ? 'bg-status-success/10 text-status-success' : 'bg-status-error/10 text-status-error'
                  )}>
                    {ride.status}
                  </span>
                </div>
                <div className="text-right">
                  <p className="font-bold text-text-primary">₹{ride.fare}</p>
                  <p className="text-xs text-text-muted">{ride.date}</p>
                </div>
              </div>

              <div className="space-y-2 mb-3">
                <div className="flex items-start gap-2">
                  <div className="mt-1.5 w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                  <p className="text-sm text-text-primary line-clamp-1">{ride.pickup}</p>
                </div>
                <div className="ml-[3px] w-px h-3 bg-border" />
                <div className="flex items-start gap-2">
                  <div className="mt-1.5 w-2 h-2 rounded-full bg-text-primary flex-shrink-0" />
                  <p className="text-sm text-text-primary line-clamp-1">{ride.drop}</p>
                </div>
              </div>

              {ride.status === 'completed' && ride.rating && (
                <div className="flex items-center gap-1 pt-3 border-t border-border">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      size={13}
                      className={cn(
                        i < ride.rating! ? 'fill-status-warning text-status-warning' : 'fill-border text-border'
                      )}
                    />
                  ))}
                  <span className="text-xs text-text-muted ml-1">{ride.vehicleType}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
