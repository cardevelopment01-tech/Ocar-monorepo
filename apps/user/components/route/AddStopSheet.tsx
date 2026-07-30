'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Search, X, MapPin, Clock } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { geoApi, type PlaceSuggestion } from '@/lib/geo-api'

// Add-stop bottom sheet — replaces the full-screen /search bounce with an
// in-context sheet over the current booking screen (docs/MULTI_STOP_UI_REDESIGN_PLAN.md §3.1).
// Matches the app's BookingForSheet motion language (scrim + spring slide-up).

const EASE = [0.22, 1, 0.36, 1] as const

// A few common Odisha places as a zero-typing fallback, mirroring /search's list.
const POPULAR = [
  { label: 'Cuttack City',            address: 'Cuttack, Odisha',              lat: 20.4625, lng: 85.8830 },
  { label: 'Puri Railway Station',    address: 'Puri, Odisha',                 lat: 19.8014, lng: 85.8142 },
  { label: 'Bhubaneswar Airport',     address: 'Bhubaneswar Airport',          lat: 20.2444, lng: 85.8178 },
  { label: 'KIIT University',         address: 'Patia, Bhubaneswar',           lat: 20.3560, lng: 85.8181 },
  { label: 'Jagannath Temple, Puri',  address: 'Grand Road, Puri',             lat: 19.8048, lng: 85.8180 },
]

export type PickedStop = { lat: number; lng: number; address: string }

type Props = {
  open: boolean
  onClose: () => void
  onSelect: (stop: PickedStop) => void
  title?: string
  originLat?: number
  originLng?: number
}

export default function AddStopSheet({ open, onClose, onSelect, title = 'Add a stop', originLat, originLng }: Props) {
  const reduce = useReducedMotion()
  const [query, setQuery]             = useState('')
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [searching, setSearching]     = useState(false)
  const [resolving, setResolving]     = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef    = useRef<HTMLInputElement>(null)

  // Reset + focus on open.
  useEffect(() => {
    if (!open) return
    setQuery(''); setSuggestions([]); setSearching(false); setResolving(false)
    const t = setTimeout(() => inputRef.current?.focus(), 80)
    return () => {
      clearTimeout(t)
      if (debounceRef.current) clearTimeout(debounceRef.current)  // cancel any in-flight search on close/unmount
    }
  }, [open])

  const runSearch = useCallback((q: string) => {
    if (q.length < 2) { setSuggestions([]); setSearching(false); return }
    setSearching(true)
    geoApi.autocomplete(q, originLat, originLng)
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setSearching(false))
  }, [originLat, originLng])

  function handleQueryChange(val: string) {
    setQuery(val)
    setSuggestions([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!val) { setSearching(false); return }
    setSearching(true)
    debounceRef.current = setTimeout(() => runSearch(val), 300)
  }

  async function pickSuggestion(s: PlaceSuggestion) {
    setResolving(true)
    try {
      const d = await geoApi.placeDetails(s.placeId)
      onSelect({ lat: d.latitude, lng: d.longitude, address: d.address })
    } catch {
      setResolving(false)
    }
  }

  const showSuggestions = query.length >= 2

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="addstop-backdrop"
            className="absolute inset-0 z-40"
            style={{ background: 'rgba(15,23,42,0.48)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.2 }}
            onClick={onClose}
          />
          <motion.div
            key="addstop-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="absolute bottom-0 left-0 right-0 z-50 bg-white flex flex-col"
            style={{
              height: '85%',
              borderRadius: '32px 32px 0 0',
              boxShadow: '0 -6px 32px rgba(10, 159, 176,0.10)',
            }}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 40 }}
          >
            <div className="w-9 h-1 rounded-full mx-auto mt-3 mb-3 flex-shrink-0" style={{ background: 'rgba(10, 159, 176,0.15)' }} />

            <div className="flex items-center justify-between px-5 mb-3 flex-shrink-0">
              <p className="text-[18px] font-bold" style={{ color: '#0F172A', letterSpacing: '-0.01em' }}>{title}</p>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-9 h-9 rounded-full flex items-center justify-center active:opacity-60 transition-opacity"
                style={{ background: '#E4F8FA' }}
              >
                <X size={16} strokeWidth={2} style={{ color: '#0A9FB0' }} />
              </button>
            </div>

            {/* Search field */}
            <div className="px-5 mb-2 flex-shrink-0">
              <div className="flex items-center gap-2.5 px-4 rounded-2xl" style={{ background: '#F5F7FF', height: 52 }}>
                <div className="w-2.5 h-2.5 flex-shrink-0" style={{ background: '#DC3E93', borderRadius: 3 }} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => handleQueryChange(e.target.value)}
                  placeholder="Search for a stop"
                  aria-label="Search for a stop"
                  disabled={resolving}
                  className="flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:text-[#94A3B8]"
                  style={{ color: '#0F172A' }}
                />
                {searching ? (
                  <OcarSpinner size={15} variant="color" className="flex-shrink-0" />
                ) : query ? (
                  <button onClick={() => handleQueryChange('')} aria-label="Clear" className="w-6 h-6 flex items-center justify-center">
                    <X size={14} style={{ color: '#94A3B8' }} />
                  </button>
                ) : (
                  <Search size={16} style={{ color: '#94A3B8' }} className="flex-shrink-0" />
                )}
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-4 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
              {showSuggestions ? (
                suggestions.length === 0 && !searching ? (
                  <p className="text-center text-[13px] py-10" style={{ color: '#94A3B8' }}>Nothing found. Try a different search.</p>
                ) : (
                  suggestions.map((s, i) => (
                    <div key={s.placeId}>
                      <button
                        onClick={() => pickSuggestion(s)}
                        disabled={resolving}
                        className="w-full flex items-center gap-3 px-2 py-3 text-left active:bg-[#F8FAFF] rounded-xl transition-colors"
                      >
                        <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#F5F7FF' }}>
                          <MapPin size={16} strokeWidth={1.8} style={{ color: '#94A3B8' }} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-medium truncate" style={{ color: '#0F172A' }}>{s.mainText}</span>
                          {s.secondaryText && <span className="block text-[11px] truncate mt-0.5" style={{ color: '#94A3B8' }}>{s.secondaryText}</span>}
                        </span>
                      </button>
                      {i < suggestions.length - 1 && <div className="ml-12 border-t border-dashed" style={{ borderColor: '#E8EEFF' }} />}
                    </div>
                  ))
                )
              ) : (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wide px-2 pt-1 pb-1" style={{ color: '#94A3B8' }}>Popular places</p>
                  {POPULAR.map((p, i) => (
                    <div key={p.label}>
                      <button
                        onClick={() => onSelect({ lat: p.lat, lng: p.lng, address: p.address })}
                        disabled={resolving}
                        className="w-full flex items-center gap-3 px-2 py-3 text-left active:bg-[#F8FAFF] rounded-xl transition-colors"
                      >
                        <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#F5F7FF' }}>
                          <Clock size={15} strokeWidth={1.6} style={{ color: '#94A3B8' }} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-medium" style={{ color: '#0F172A' }}>{p.label}</span>
                          <span className="block text-[11px] truncate mt-0.5" style={{ color: '#94A3B8' }}>{p.address}</span>
                        </span>
                      </button>
                      {i < POPULAR.length - 1 && <div className="ml-12 border-t border-dashed" style={{ borderColor: '#E8EEFF' }} />}
                    </div>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
