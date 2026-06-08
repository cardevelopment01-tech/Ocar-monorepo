'use client'

import { useState } from 'react'
import { ArrowLeft, MapPin, Clock, Star, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { mockPickup, mockDrop } from '@/lib/mock-data'

const RECENT = [
  { icon: Clock, label: 'KIIT University, Patia', sub: '3.2 km · Yesterday' },
  { icon: Clock, label: 'Esplanade One Mall', sub: '5.1 km · Mon' },
  { icon: Clock, label: 'Bhubaneswar Railway Station', sub: '7.8 km · Sun' },
]

const SAVED = [
  { icon: '🏠', label: 'Home', sub: 'Sahid Nagar, Bhubaneswar' },
  { icon: '💼', label: 'Work', sub: 'Infocity, Chandrasekharpur' },
]

export default function SearchPage() {
  const router = useRouter()
  const [pickup, setPickup] = useState('Current Location')
  const [drop, setDrop] = useState('')
  const [activeField, setActiveField] = useState<'pickup' | 'drop'>('drop')

  function handleSelectPlace(label: string) {
    if (activeField === 'drop') {
      setDrop(label)
      if (pickup) {
        router.push('/select-ride')
      }
    } else {
      setPickup(label)
      setActiveField('drop')
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-surface shadow-card px-4 pt-safe-top pb-4">
        <div className="flex items-center gap-3 pt-3 mb-4">
          <button onClick={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={22} className="text-text-primary" />
          </button>
          <span className="font-semibold text-text-primary">Set your route</span>
        </div>

        {/* Pickup */}
        <div
          onClick={() => setActiveField('pickup')}
          className={`flex items-center gap-3 px-4 py-3 rounded-2xl mb-2 cursor-text transition-colors ${
            activeField === 'pickup' ? 'bg-primary-subtle ring-2 ring-primary' : 'bg-background'
          }`}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-primary flex-shrink-0" />
          <input
            value={pickup}
            onChange={e => setPickup(e.target.value)}
            placeholder="Pickup location"
            className="flex-1 bg-transparent text-sm text-text-primary outline-none"
            onFocus={() => setActiveField('pickup')}
          />
          {pickup && (
            <button onClick={() => setPickup('')}>
              <X size={14} className="text-text-muted" />
            </button>
          )}
        </div>

        {/* Drop */}
        <div
          onClick={() => setActiveField('drop')}
          className={`flex items-center gap-3 px-4 py-3 rounded-2xl cursor-text transition-colors ${
            activeField === 'drop' ? 'bg-primary-subtle ring-2 ring-primary' : 'bg-background'
          }`}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-text-primary flex-shrink-0" />
          <input
            value={drop}
            onChange={e => setDrop(e.target.value)}
            placeholder="Where to?"
            className="flex-1 bg-transparent text-sm text-text-primary outline-none"
            autoFocus
            onFocus={() => setActiveField('drop')}
          />
          {drop && (
            <button onClick={() => setDrop('')}>
              <X size={14} className="text-text-muted" />
            </button>
          )}
        </div>
      </div>

      {/* Suggestions */}
      <div className="flex-1 overflow-y-auto px-4 pt-4">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Saved places</p>
        {SAVED.map(p => (
          <button
            key={p.label}
            onClick={() => handleSelectPlace(p.sub)}
            className="w-full flex items-center gap-3 py-3 border-b border-border"
          >
            <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center text-lg shadow-card">
              {p.icon}
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-text-primary">{p.label}</p>
              <p className="text-xs text-text-muted">{p.sub}</p>
            </div>
          </button>
        ))}

        <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mt-4 mb-2">Recent</p>
        {RECENT.map(p => (
          <button
            key={p.label}
            onClick={() => handleSelectPlace(p.label)}
            className="w-full flex items-center gap-3 py-3 border-b border-border"
          >
            <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center shadow-card">
              <p.icon size={18} className="text-text-muted" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-text-primary">{p.label}</p>
              <p className="text-xs text-text-muted">{p.sub}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
