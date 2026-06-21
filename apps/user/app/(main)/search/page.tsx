'use client'

import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Plane, Train, Building2, ShoppingBag,
  GraduationCap, X, Loader2, Map, ArrowUpDown,
  Plus, ChevronDown, UserPlus, User, Info, Clock, Heart,
} from 'lucide-react'
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
  { Icon: Plane,          label: 'Bhubaneswar Airport',     address: 'Bhubaneswar Airport, Bhubaneswar', lat: 20.2444, lng: 85.8178 },
  { Icon: Train,          label: 'Bhubaneswar Railway Stn', address: 'Bhubaneswar Junction',             lat: 20.2663, lng: 85.8424 },
  { Icon: Building2,      label: 'AIIMS Bhubaneswar',       address: 'AIIMS, Sijua, Bhubaneswar',        lat: 20.1823, lng: 85.7698 },
  { Icon: ShoppingBag,    label: 'Esplanade One',           address: 'Rasulgarh, Bhubaneswar',           lat: 20.2877, lng: 85.8508 },
  { Icon: GraduationCap,  label: 'KIIT University',         address: 'Patia, Bhubaneswar',               lat: 20.3560, lng: 85.8181 },
  { Icon: Building2,      label: 'Cuttack City',            address: 'Cuttack, Odisha',                  lat: 20.4625, lng: 85.8830 },
  { Icon: Train,          label: 'Puri Railway Station',    address: 'Puri, Odisha',                     lat: 19.8014, lng: 85.8142 },
  { Icon: Building2,      label: 'Infocity, Bhubaneswar',  address: 'Infocity, Patia, Bhubaneswar',     lat: 20.3474, lng: 85.8197 },
]

const ICON_BG  = '#F1F0FE'
const ICON_CLR = '#4F46E5'

type EditMode = 'destination' | 'origin'

type ConfirmedDest = { lat: number; lng: number; address: string }

function SearchContent() {
  const router = useRouter()
  const sp     = useSearchParams()

  const [originLat,     setOriginLat]     = useState(() => parseFloat(sp.get('originLat') ?? '') || DEFAULT_ORIGIN.lat)
  const [originLng,     setOriginLng]     = useState(() => parseFloat(sp.get('originLng') ?? '') || DEFAULT_ORIGIN.lng)
  const [originAddress, setOriginAddress] = useState(() => sp.get('originAddress') ?? DEFAULT_ORIGIN.address)

  // Destination is stored explicitly so swap can exchange both ends
  const [confirmedDest, setConfirmedDest] = useState<ConfirmedDest | null>(null)

  const [mode,        setMode]        = useState<EditMode>('destination')
  const [query,       setQuery]       = useState('')
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [searching,   setSearching]   = useState(false)
  const [resolving,   setResolving]   = useState(false)

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const destInputRef   = useRef<HTMLInputElement>(null)
  const originInputRef = useRef<HTMLInputElement>(null)
  // Tracks whether user has actually typed in origin mode (vs. the pre-populated default)
  const originTouched  = useRef(false)

  const [forMeOpen, setForMeOpen] = useState(false)
  const [stopToast, setStopToast] = useState(false)

  // On mount: if no origin in URL, try to get GPS + reverse-geocode
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

  // Focus the right input when mode changes; select-all in origin so typing replaces pre-populated text
  useEffect(() => {
    if (mode === 'destination') {
      setTimeout(() => destInputRef.current?.focus(), 60)
    } else {
      setTimeout(() => {
        originInputRef.current?.focus()
        originInputRef.current?.select()
      }, 60)
    }
  }, [mode])

  // Auto-dismiss "add stops" toast
  useEffect(() => {
    if (!stopToast) return
    const t = setTimeout(() => setStopToast(false), 1800)
    return () => clearTimeout(t)
  }, [stopToast])

  const runSearch = useCallback((q: string, lat: number, lng: number) => {
    if (!q || q.length < 2) { setSuggestions([]); setSearching(false); return }
    setSearching(true)
    geoApi.autocomplete(q, lat, lng)
      .then(r => setSuggestions(r))
      .catch(() => setSuggestions([]))
      .finally(() => setSearching(false))
  }, [])

  function handleQueryChange(val: string) {
    originTouched.current = true
    setQuery(val)
    setSuggestions([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!val) return
    setSearching(true)
    debounceRef.current = setTimeout(
      () => runSearch(val, originLat, originLng),
      300,
    )
  }

  function refreshOriginInBackground() {
    if (!navigator.geolocation) return
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
  }

  function switchMode(next: EditMode) {
    // Leaving origin with cleared FROM → silently restore GPS (Uber/Ola pattern)
    if (mode === 'origin' && next === 'destination' && query.trim() === '') {
      refreshOriginInBackground()
    }
    setMode(next)
    setSuggestions([])
    setSearching(false)
    if (next === 'origin') {
      originTouched.current = false
      setQuery(originAddress)   // pre-populate so FROM never looks blank
    } else {
      setQuery('')
    }
  }

  // Navigate to select-ride with real route
  async function navigateToRide(dest: ConfirmedDest, oLat = originLat, oLng = originLng, oAddress = originAddress) {
    setResolving(true)
    try {
      const route = await geoApi.getRoute(oLat, oLng, dest.lat, dest.lng)
      const params = new URLSearchParams({
        originLat:          String(oLat),
        originLng:          String(oLng),
        originAddress:      oAddress,
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

  // Confirm a destination: store it in state, collapse suggestions, switch focus to origin if unset
  function confirmDest(lat: number, lng: number, address: string) {
    setConfirmedDest({ lat, lng, address })
    setQuery('')
    setSuggestions([])
    setSearching(false)
    // If origin is already a real location (not the bare city default), go straight to prices
    if (originAddress !== DEFAULT_ORIGIN.address) {
      void navigateToRide({ lat, lng, address })
    } else {
      switchMode('origin')
    }
  }

  async function selectDestinationSuggestion(s: PlaceSuggestion) {
    setResolving(true)
    try {
      const detail = await geoApi.placeDetails(s.placeId)
      setResolving(false)
      confirmDest(detail.latitude, detail.longitude, detail.address)
    } catch {
      setResolving(false)
    }
  }

  async function selectOriginSuggestion(s: PlaceSuggestion) {
    setResolving(true)
    try {
      const detail = await geoApi.placeDetails(s.placeId)
      setOriginLat(detail.latitude)
      setOriginLng(detail.longitude)
      setOriginAddress(detail.address)
      setResolving(false)
      // Always switch to destination mode so FROM shows the resolved address (not old query text)
      switchMode('destination')
      if (confirmedDest) {
        void navigateToRide(confirmedDest, detail.latitude, detail.longitude, detail.address)
      }
    } catch {
      setResolving(false)
    }
  }

  // True bidirectional swap — exchanges origin ↔ confirmedDest then navigates
  function swapOriginDestination() {
    if (!confirmedDest) return
    const prevOrigin: ConfirmedDest = { lat: originLat, lng: originLng, address: originAddress }
    setOriginLat(confirmedDest.lat)
    setOriginLng(confirmedDest.lng)
    setOriginAddress(confirmedDest.address)
    setConfirmedDest(prevOrigin)
    setQuery('')
    setSuggestions([])
    setMode('destination')
    void navigateToRide(prevOrigin, confirmedDest.lat, confirmedDest.lng, confirmedDest.address)
  }

  function goToMapPicker() {
    const params = new URLSearchParams({
      centerLat: String(originLat),
      centerLng: String(originLng),
    })
    router.push(`/confirm-pickup?${params.toString()}`)
  }

  // In origin mode, only show suggestions after the user has actually typed (not the pre-populated address)
  const showSuggestions = query.length >= 2 && (mode === 'destination' || originTouched.current)
  const bothConfirmed   = confirmedDest !== null

  return (
    <div className="h-full flex flex-col bg-background relative">

      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-white pt-safe-top">
        <div className="flex items-center gap-3 px-4 pt-3 pb-3">
          <motion.button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0"
            whileTap={{ scale: 0.88 }} transition={SPRING}
          >
            <ArrowLeft size={17} className="text-text-primary" strokeWidth={2} />
          </motion.button>
          <span className="text-base font-bold text-text-primary">Plan your trip</span>

          {/* For me pill */}
          <motion.button
            onClick={() => setForMeOpen(true)}
            className="ml-auto flex items-center gap-1.5 h-9 pl-2.5 pr-2 rounded-full bg-surface border border-border"
            whileTap={{ scale: 0.94 }} transition={SPRING}
          >
            <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: ICON_BG }}>
              <span className="text-[10px] font-bold leading-none" style={{ color: ICON_CLR }}>Me</span>
            </span>
            <span className="text-xs font-semibold text-text-primary">For me</span>
            <ChevronDown size={13} className="text-text-muted" strokeWidth={2.2} />
          </motion.button>
        </div>

        {/* Unified from → to card */}
        <div className="mx-4 mb-2 rounded-2xl overflow-hidden border border-slate-100 bg-white">
          <div className="flex items-stretch">

            {/* Left icon column: green dot → dashed line → amber dot */}
            <div className="flex flex-col items-center px-4 pt-[22px] pb-[22px]">
              <div className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0 shadow-sm" />
              <div
                className="w-px flex-1 my-2"
                style={{ background: 'repeating-linear-gradient(to bottom, #CBD5E1 0px, #CBD5E1 4px, transparent 4px, transparent 8px)' }}
              />
              <div className="w-3 h-3 rounded-full bg-amber-500 flex-shrink-0 shadow-sm" />
            </div>

            {/* Input column */}
            <div className="flex-1 min-w-0">
              {/* FROM row */}
              <motion.button
                onClick={() => { if (mode !== 'origin') switchMode('origin') }}
                className="w-full text-left px-3 pt-3 pb-3 border-b border-border"
                whileTap={{ scale: 0.99 }} transition={SPRING}
              >
                <p className="text-[9px] font-semibold uppercase tracking-widest text-text-muted mb-1.5 leading-none">From</p>
                {mode === 'origin' ? (
                  <div className="flex items-center gap-1">
                    <input
                      ref={originInputRef}
                      value={query}
                      onChange={e => handleQueryChange(e.target.value)}
                      placeholder="Enter pickup location"
                      className="flex-1 bg-transparent text-[14px] font-medium text-text-primary placeholder:text-text-muted placeholder:font-normal outline-none"
                      disabled={resolving}
                    />
                    {searching && <Loader2 size={13} className="text-primary animate-spin flex-shrink-0" />}
                    {query && !searching && (
                      <motion.button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); setQuery(''); setSuggestions([]) }}
                        whileTap={{ scale: 0.85 }}
                        className="w-7 h-7 flex items-center justify-center"
                      >
                        <X size={13} className="text-text-muted" />
                      </motion.button>
                    )}
                  </div>
                ) : (
                  <p className="text-[14px] font-medium text-text-primary truncate">{originAddress}</p>
                )}
              </motion.button>

              {/* TO row */}
              <div
                className="px-3 pt-3 pb-3 cursor-text"
                onClick={() => {
                  if (confirmedDest) {
                    setConfirmedDest(null); switchMode('destination')
                  } else if (mode !== 'destination') {
                    switchMode('destination')
                  }
                }}
              >
                <p className="text-[9px] font-semibold uppercase tracking-widest text-text-muted mb-1.5 leading-none">To</p>
                {confirmedDest ? (
                  // Always show confirmed destination as text — never blank during navigation
                  <div className="flex items-center gap-1">
                    <p className="text-[14px] font-medium text-text-primary truncate flex-1">{confirmedDest.address}</p>
                    <motion.button
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); setConfirmedDest(null); switchMode('destination') }}
                      whileTap={{ scale: 0.85 }}
                      className="w-7 h-7 flex items-center justify-center flex-shrink-0"
                    >
                      <X size={13} className="text-text-muted" />
                    </motion.button>
                  </div>
                ) : mode === 'destination' ? (
                  <div className="flex items-center gap-1">
                    <input
                      ref={destInputRef}
                      value={query}
                      onChange={e => handleQueryChange(e.target.value)}
                      placeholder="Where to?"
                      className="flex-1 bg-transparent text-[14px] font-medium text-text-primary placeholder:text-text-muted placeholder:font-normal outline-none"
                      disabled={resolving}
                    />
                    {searching && <Loader2 size={13} className="text-primary animate-spin flex-shrink-0" />}
                    {query && !searching && (
                      <motion.button
                        onClick={() => { setQuery(''); setSuggestions([]) }}
                        whileTap={{ scale: 0.85 }}
                        className="w-7 h-7 flex items-center justify-center"
                      >
                        <X size={13} className="text-text-muted" />
                      </motion.button>
                    )}
                  </div>
                ) : (
                  <p className="text-[14px] text-text-muted font-normal">Where to?</p>
                )}
              </div>
            </div>

            {/* Swap button */}
            <motion.button
              onClick={swapOriginDestination}
              disabled={!bothConfirmed}
              className="self-center mr-3 flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center border transition-colors"
              style={{
                background: bothConfirmed ? 'var(--color-primary-subtle, #EEF2FF)' : 'var(--color-surface-2, #F8FAFF)',
                borderColor: bothConfirmed ? 'var(--color-primary, #4F46E5)' : 'var(--color-border, #E5E7EB)',
              }}
              whileTap={bothConfirmed ? { scale: 0.88, rotate: 180 } : {}}
              transition={SPRING}
              title="Swap pickup and destination"
            >
              <ArrowUpDown size={15} className={bothConfirmed ? 'text-primary' : 'text-text-muted'} strokeWidth={2} />
            </motion.button>
          </div>
        </div>

        {/* Pinned action pills — always fixed, never scroll */}
        <div className="flex gap-2.5 px-4 pb-2">
          <motion.button
            onClick={goToMapPicker}
            className="flex-1 h-9 rounded-full flex items-center justify-center gap-1.5 border border-slate-200 bg-white"
            whileTap={{ scale: 0.97 }} transition={SPRING}
          >
            <Map size={14} strokeWidth={1.8} style={{ color: ICON_CLR }} />
            <span className="text-[13px] font-semibold text-slate-700">Select on map</span>
          </motion.button>
          <motion.button
            onClick={() => setStopToast(true)}
            className="flex-1 h-9 rounded-full flex items-center justify-center gap-1.5 bg-slate-900"
            whileTap={{ scale: 0.97 }} transition={SPRING}
          >
            <Plus size={14} strokeWidth={2.2} className="text-white" />
            <span className="text-[13px] font-semibold text-white">Add stops</span>
          </motion.button>
        </div>

        {/* Get prices CTA — slides in when both confirmed */}
        <AnimatePresence>
          {bothConfirmed && (
            <motion.div
              className="px-4 pb-3"
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              <motion.button
                onClick={() => confirmedDest && void navigateToRide(confirmedDest)}
                className="w-full py-3 rounded-2xl text-[15px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}
                disabled={resolving}
                whileTap={{ scale: 0.98 }}
              >
                {resolving
                  ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Getting route…</span>
                  : 'See ride prices →'
                }
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hairline divider — separates fixed header from scrollable body */}
        <div className="h-px bg-slate-100" />
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-2 pb-4 relative bg-white">

        {/* Resolve overlay */}
        <AnimatePresence>
          {resolving && (
            <motion.div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              <Loader2 size={28} className="text-primary animate-spin" />
              <span className="text-sm text-text-secondary font-medium">
                {mode === 'origin' ? 'Setting pickup…' : 'Getting route…'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Origin edit mode ── */}
        {mode === 'origin' && (
          <motion.div
            key="origin-panel"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {/* Origin autocomplete suggestions — body is empty until user types 2+ chars */}
            {showSuggestions && (
              <motion.div variants={listStagger} initial="hidden" animate="show">
                {suggestions.length === 0 && !searching ? (
                  <motion.p variants={fadeUp} className="text-center text-sm text-text-muted py-10">
                    Nothing found. Try a different search.
                  </motion.p>
                ) : (
                  <div className="mt-1">
                    {suggestions.map((s, i) => (
                      <div key={s.placeId}>
                        <motion.button
                          onClick={() => selectOriginSuggestion(s)}
                          className="w-full flex items-center gap-3 px-1 py-3 text-left"
                          variants={rowVariant}
                          whileTap={{ backgroundColor: '#F8FAFF' }} transition={SPRING}
                        >
                          <span className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
                            <Clock size={16} className="text-text-muted" strokeWidth={1.6} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-medium text-text-primary truncate">{s.mainText}</span>
                            {s.secondaryText && (
                              <span className="block text-[11px] text-text-muted truncate mt-0.5">{s.secondaryText}</span>
                            )}
                          </span>
                          <Heart size={16} className="text-text-muted flex-shrink-0" strokeWidth={1.6} />
                        </motion.button>
                        {i < suggestions.length - 1 && (
                          <div className="ml-12 border-t border-dashed border-border" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ── Destination edit mode ── */}
        {mode === 'destination' && (
          <>
            {showSuggestions ? (
              <motion.div variants={listStagger} initial="hidden" animate="show" key="suggestions">
                {suggestions.length === 0 && !searching ? (
                  <motion.p variants={fadeUp} className="text-center text-sm text-text-muted py-10">
                    Nothing found. Try a different search.
                  </motion.p>
                ) : (
                  <div className="mt-1">
                    {suggestions.map((s, i) => (
                      <div key={s.placeId}>
                        <motion.button
                          onClick={() => selectDestinationSuggestion(s)}
                          className="w-full flex items-center gap-3 px-1 py-3 text-left"
                          variants={rowVariant}
                          whileTap={{ backgroundColor: '#F8FAFF' }} transition={SPRING}
                        >
                          <span className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
                            <Clock size={16} className="text-text-muted" strokeWidth={1.6} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-medium text-text-primary truncate">{s.mainText}</span>
                            {s.secondaryText && (
                              <span className="block text-[11px] text-text-muted truncate mt-0.5">{s.secondaryText}</span>
                            )}
                          </span>
                          <Heart size={16} className="text-text-muted flex-shrink-0" strokeWidth={1.6} />
                        </motion.button>
                        {i < suggestions.length - 1 && (
                          <div className="ml-12 border-t border-dashed border-border" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <>
                {/* Popular destinations */}
                <motion.div variants={listStagger} initial="hidden" animate="show">
                  <div className="mt-0">
                    {POPULAR.map((d, i) => (
                      <div key={d.label}>
                        <motion.button
                          onClick={() => confirmDest(d.lat, d.lng, d.address)}
                          className="w-full flex items-center gap-3 px-1 py-3 text-left"
                          variants={rowVariant}
                          whileTap={{ backgroundColor: '#F8FAFF' }} transition={SPRING}
                        >
                          <span className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
                            <d.Icon size={15} strokeWidth={1.6} style={{ color: ICON_CLR }} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-medium text-text-primary">{d.label}</span>
                            <span className="block text-[11px] text-text-muted truncate mt-0.5">{d.address}</span>
                          </span>
                          <Heart size={16} className="text-text-muted flex-shrink-0" strokeWidth={1.6} />
                        </motion.button>
                        {i < POPULAR.length - 1 && (
                          <div className="ml-12 border-t border-dashed border-border" />
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </>
        )}
      </div>

      {/* Booking-for bottom sheet */}
      <AnimatePresence>
        {forMeOpen && (
          <>
            <motion.div
              key="forme-backdrop"
              className="absolute inset-0 z-40 bg-black/40"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setForMeOpen(false)}
            />
            <motion.div
              key="forme-sheet"
              className="absolute bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl px-6 pt-3"
              style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom, 0px))' }}
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 40 }}
            >
              <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-5" />
              <p className="text-xl font-bold text-text-primary mb-5">Booking ride for</p>

              <button
                onClick={() => setForMeOpen(false)}
                className="w-full flex items-center gap-4 py-4 border-b border-border"
              >
                <span className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
                  <User size={18} className="text-text-secondary" strokeWidth={1.8} />
                </span>
                <span className="flex-1 text-[15px] font-semibold text-text-primary text-left">Myself</span>
                <span className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                </span>
              </button>

              <button
                disabled
                className="w-full flex items-center gap-4 py-4 border-b border-border opacity-50"
              >
                <span className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
                  <UserPlus size={18} className="text-primary" strokeWidth={1.8} />
                </span>
                <span className="flex-1 text-left">
                  <span className="block text-[15px] font-semibold text-primary">Add new rider</span>
                </span>
              </button>

              <div className="mt-4 mb-6 flex items-start gap-3 bg-surface-2 rounded-2xl px-4 py-3">
                <Info size={15} className="text-text-muted flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                <p className="text-xs text-text-muted leading-relaxed">Contact name won&apos;t be shared with your driver</p>
              </div>

              <button
                onClick={() => setForMeOpen(false)}
                className="w-full py-4 rounded-full text-[15px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)' }}
              >
                Done
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add stops coming-soon toast */}
      <AnimatePresence>
        {stopToast && (
          <motion.div
            key="stop-toast"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="absolute left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-full bg-slate-900 text-white text-xs font-semibold shadow-lg whitespace-nowrap"
            style={{ bottom: 'max(24px, env(safe-area-inset-bottom, 0px))' }}
          >
            Multi-stop trips are coming soon
          </motion.div>
        )}
      </AnimatePresence>
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
