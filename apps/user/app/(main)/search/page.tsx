'use client'

import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, MapPin, Clock, Plane, Train, Building2, ShoppingBag, GraduationCap, Navigation2, X, Loader2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { geoApi, type PlaceSuggestion } from '@/lib/geo-api'

const EASE   = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } },
}
const listStagger = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
}
const rowVariant = {
  hidden: { opacity: 0, x: -8 },
  show:   { opacity: 1, x: 0, transition: { duration: 0.25, ease: EASE } },
}

const DEFAULT_ORIGIN = { lat: 20.2961, lng: 85.8245, address: 'Bhubaneswar' }

const POPULAR = [
  { Icon: Plane,         label: 'Bhubaneswar Airport',      address: 'Bhubaneswar Airport, Bhubaneswar', lat: 20.2444, lng: 85.8178 },
  { Icon: Train,         label: 'Bhubaneswar Railway Stn',  address: 'Bhubaneswar Junction',             lat: 20.2663, lng: 85.8424 },
  { Icon: Building2,     label: 'AIIMS Bhubaneswar',        address: 'AIIMS, Sijua, Bhubaneswar',        lat: 20.1823, lng: 85.7698 },
  { Icon: ShoppingBag,   label: 'Esplanade One',            address: 'Rasulgarh, Bhubaneswar',           lat: 20.2877, lng: 85.8508 },
  { Icon: GraduationCap, label: 'KIIT University',          address: 'Patia, Bhubaneswar',               lat: 20.3560, lng: 85.8181 },
  { Icon: Building2,     label: 'Cuttack City',             address: 'Cuttack, Odisha',                  lat: 20.4625, lng: 85.8830 },
]

const RECENTS = [
  { label: 'KIIT University, Patia', destIndex: 4 },
  { label: 'Esplanade One Mall',     destIndex: 3 },
]

const ICON_BG  = '#F1F0FE'
const ICON_CLR = '#4F46E5'

function SearchContent() {
  const router = useRouter()
  const sp     = useSearchParams()

  const [originLat,     setOriginLat]     = useState(() => parseFloat(sp.get('originLat') ?? '') || DEFAULT_ORIGIN.lat)
  const [originLng,     setOriginLng]     = useState(() => parseFloat(sp.get('originLng') ?? '') || DEFAULT_ORIGIN.lng)
  const [originAddress, setOriginAddress] = useState(() => sp.get('originAddress') ?? DEFAULT_ORIGIN.address)

  const [query,       setQuery]       = useState('')
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [searching,   setSearching]   = useState(false)
  const [resolving,   setResolving]   = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (sp.get('originLat') || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords
        setOriginLat(latitude)
        setOriginLng(longitude)
        setOriginAddress('Current Location')
        geoApi.reverseGeocode(latitude, longitude)
          .then(addr => setOriginAddress(addr))
          .catch(() => {})
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [sp])

  const runSearch = useCallback((q: string) => {
    if (!q || q.length < 2) {
      setSuggestions([])
      setSearching(false)
      return
    }
    setSearching(true)
    geoApi.autocomplete(q, originLat, originLng)
      .then(results => setSuggestions(results))
      .catch(() => setSuggestions([]))
      .finally(() => setSearching(false))
  }, [originLat, originLng])

  function handleQueryChange(val: string) {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!val) { setSuggestions([]); return }
    setSearching(true)
    debounceRef.current = setTimeout(() => runSearch(val), 300)
  }

  async function selectSuggestion(suggestion: PlaceSuggestion) {
    setResolving(true)
    try {
      const detail = await geoApi.placeDetails(suggestion.placeId)
      const route  = await geoApi.getRoute(originLat, originLng, detail.latitude, detail.longitude)
      const params = new URLSearchParams({
        originLat:          String(originLat),
        originLng:          String(originLng),
        originAddress,
        destinationLat:     String(detail.latitude),
        destinationLng:     String(detail.longitude),
        destinationAddress: detail.address,
        distanceKm:         String(route.distanceKm),
        durationMin:        String(route.durationMin),
        originCityId:       '1',
      })
      if (route.polyline) params.set('polyline', route.polyline)
      router.push(`/select-ride?${params.toString()}`)
    } catch {
      setResolving(false)
    }
  }

  async function selectPopular(dest: typeof POPULAR[0]) {
    setResolving(true)
    try {
      const route = await geoApi.getRoute(originLat, originLng, dest.lat, dest.lng)
      const params = new URLSearchParams({
        originLat:          String(originLat),
        originLng:          String(originLng),
        originAddress,
        destinationLat:     String(dest.lat),
        destinationLng:     String(dest.lng),
        destinationAddress: dest.address,
        distanceKm:         String(route.distanceKm),
        durationMin:        String(route.durationMin),
        originCityId:       '1',
      })
      if (route.polyline) params.set('polyline', route.polyline)
      router.push(`/select-ride?${params.toString()}`)
    } catch {
      setResolving(false)
    }
  }

  const showSuggestions = query.length >= 2

  return (
    <div className="h-full flex flex-col bg-background">

      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-surface border-b border-border pt-safe-top">
        <div className="flex items-center gap-3 px-4 pt-3 pb-3">
          <motion.button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0"
            whileTap={{ scale: 0.88 }}
            transition={SPRING}
          >
            <ArrowLeft size={17} className="text-text-primary" strokeWidth={2} />
          </motion.button>
          <span className="text-base font-bold text-text-primary">Plan your trip</span>
        </div>

        {/* Origin row */}
        <div className="flex items-center gap-3 mx-4 mb-3 px-4 py-3 rounded-2xl bg-surface-2 border border-border">
          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <Navigation2 size={10} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="flex-1 text-sm font-medium text-text-secondary truncate">{originAddress}</span>
        </div>

        {/* Destination input */}
        <div className="flex items-center gap-3 mx-4 mb-4 px-4 py-3 rounded-2xl bg-primary-subtle border-2 border-primary">
          <div className="w-2 h-2 rounded-full bg-text-primary flex-shrink-0" />
          <input
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Where to?"
            className="flex-1 bg-transparent text-sm font-medium text-text-primary placeholder:text-text-muted outline-none"
            autoFocus
            disabled={resolving}
          />
          {searching && <Loader2 size={14} className="text-primary animate-spin flex-shrink-0" />}
          {query && !searching && (
            <motion.button onClick={() => { setQuery(''); setSuggestions([]) }} whileTap={{ scale: 0.88 }}>
              <X size={14} className="text-text-muted" />
            </motion.button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-4 pb-6 relative">

        {/* Full-screen resolve overlay */}
        <AnimatePresence>
          {resolving && (
            <motion.div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Loader2 size={28} className="text-primary animate-spin" />
              <span className="text-sm text-text-secondary font-medium">Getting route…</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Autocomplete suggestions */}
        {showSuggestions ? (
          <motion.div variants={listStagger} initial="hidden" animate="show" key="suggestions">
            <motion.p variants={fadeUp} className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">
              Results
            </motion.p>

            {suggestions.length === 0 && !searching ? (
              <motion.p variants={fadeUp} className="text-center text-sm text-text-muted py-10">
                No results — try a different name
              </motion.p>
            ) : (
              <div className="bg-surface rounded-2xl border border-border overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(15,15,35,0.07)' }}>
                {suggestions.map((s, i) => (
                  <motion.button
                    key={s.placeId}
                    onClick={() => selectSuggestion(s)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left${i < suggestions.length - 1 ? ' border-b border-border' : ''}`}
                    variants={rowVariant}
                    whileTap={{ backgroundColor: '#F8FAFF' }}
                    transition={SPRING}
                  >
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: ICON_BG }}>
                      <MapPin size={14} strokeWidth={1.6} style={{ color: ICON_CLR }} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-text-primary truncate">{s.mainText}</span>
                      {s.secondaryText && (
                        <span className="block text-xs text-text-muted truncate mt-0.5">{s.secondaryText}</span>
                      )}
                    </span>
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <>
            {/* Recents */}
            <motion.div
              className="mb-5"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
            >
              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">Recent</p>
              <div className="bg-surface rounded-2xl border border-border overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(15,15,35,0.07)' }}>
                {RECENTS.map((r, i) => (
                  <motion.button
                    key={r.label}
                    onClick={() => selectPopular(POPULAR[r.destIndex]!)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left${i < RECENTS.length - 1 ? ' border-b border-border' : ''}`}
                    whileTap={{ backgroundColor: '#F8FAFF' }}
                    transition={SPRING}
                  >
                    <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
                      <Clock size={14} strokeWidth={1.6} className="text-text-muted" />
                    </span>
                    <span className="flex-1 text-sm font-medium text-text-primary truncate">{r.label}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>

            {/* Popular destinations */}
            <motion.div variants={listStagger} initial="hidden" animate="show">
              <motion.p variants={fadeUp} className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">
                Popular destinations
              </motion.p>
              <div className="bg-surface rounded-2xl border border-border overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(15,15,35,0.07)' }}>
                {POPULAR.map((d, i) => (
                  <motion.button
                    key={d.label}
                    onClick={() => selectPopular(d)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left${i < POPULAR.length - 1 ? ' border-b border-border' : ''}`}
                    variants={rowVariant}
                    whileTap={{ backgroundColor: '#F8FAFF' }}
                    transition={SPRING}
                  >
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: ICON_BG }}>
                      <d.Icon size={15} strokeWidth={1.6} style={{ color: ICON_CLR }} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-text-primary">{d.label}</span>
                      <span className="block text-xs text-text-muted truncate mt-0.5">{d.address}</span>
                    </span>
                    <MapPin size={13} className="text-text-muted flex-shrink-0" strokeWidth={1.6} />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" />
      </div>
    }>
      <SearchContent />
    </Suspense>
  )
}
