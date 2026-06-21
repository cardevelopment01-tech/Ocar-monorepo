'use client'

import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Plane, Train, Building2, ShoppingBag,
  GraduationCap, X, Loader2, Map,
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

  const [originLat,     setOriginLat]     = useState(() => parseFloat(sp.get('originLat') ?? '') || 0)
  const [originLng,     setOriginLng]     = useState(() => parseFloat(sp.get('originLng') ?? '') || 0)
  const [originAddress, setOriginAddress] = useState(() => sp.get('originAddress') ?? '')

  const [confirmedDest, setConfirmedDest] = useState<ConfirmedDest | null>(() => {
    const lat     = parseFloat(sp.get('destinationLat') ?? '')
    const lng     = parseFloat(sp.get('destinationLng') ?? '')
    const address = sp.get('destinationAddress') ?? ''
    if (!isNaN(lat) && !isNaN(lng) && address) return { lat, lng, address }
    return null
  })

  // If coming back from map picker with dest-only, prompt for origin
  const [mode, setMode] = useState<EditMode>(() => {
    const hasDest   = !!sp.get('destinationAddress')
    const hasOrigin = !!sp.get('originAddress')
    return (hasDest && !hasOrigin) ? 'origin' : 'destination'
  })
  const [query,       setQuery]       = useState('')
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [searching,   setSearching]   = useState(false)
  const [resolving,   setResolving]   = useState(false)
  // true once GPS has responded (success or failure) — prevents Bhubaneswar flash
  const [gpsReady,    setGpsReady]    = useState(() => !!sp.get('originLat'))

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const destInputRef   = useRef<HTMLInputElement>(null)
  const originInputRef = useRef<HTMLInputElement>(null)
  const originTouched  = useRef(false)
  const modeRef        = useRef<EditMode>(mode)
  const autoNavRef     = useRef(false)

  const [forMeOpen, setForMeOpen] = useState(false)
  const [stopToast, setStopToast] = useState(false)

  // On mount: try GPS once — fast network-position fix, cached ok up to 1 min
  useEffect(() => {
    if (sp.get('originLat')) return
    if (!navigator.geolocation) { setGpsReady(true); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords
        setOriginLat(latitude)
        setOriginLng(longitude)
        setOriginAddress('Current Location')
        setGpsReady(true)
        if (modeRef.current === 'origin') setQuery('Current Location')
        geoApi.reverseGeocode(latitude, longitude)
          .then(addr => {
            setOriginAddress(addr)
            if (modeRef.current === 'origin') setQuery(addr)
          })
          .catch(() => {})
      },
      () => { setGpsReady(true) },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { modeRef.current = mode }, [mode])

  // Auto-navigate when map picker returns with both origin + destination in URL
  useEffect(() => {
    if (autoNavRef.current) return
    const destLat  = parseFloat(sp.get('destinationLat') ?? '')
    const destLng  = parseFloat(sp.get('destinationLng') ?? '')
    const destAddr = sp.get('destinationAddress') ?? ''
    const origAddr = sp.get('originAddress') ?? ''
    const oLat     = parseFloat(sp.get('originLat') ?? '') || 0
    const oLng     = parseFloat(sp.get('originLng') ?? '') || 0
    if (destAddr && origAddr.trim() && !isNaN(destLat) && !isNaN(destLng)) {
      autoNavRef.current = true
      void navigateToRide({ lat: destLat, lng: destLng, address: destAddr }, oLat, oLng, origAddr, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        if (modeRef.current === 'origin') setQuery('Current Location')
        geoApi.reverseGeocode(latitude, longitude)
          .then(addr => {
            setOriginAddress(addr)
            if (modeRef.current === 'origin') setQuery(addr)
          })
          .catch(() => {})
      },
      () => {},
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 },
    )
  }

  function switchMode(next: EditMode) {
    // Leaving origin with cleared FROM and still no origin set → silently try GPS again
    if (mode === 'origin' && next === 'destination' && query.trim() === '' && originAddress.trim() === '') {
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
  async function navigateToRide(dest: ConfirmedDest, oLat = originLat, oLng = originLng, oAddress = originAddress, useReplace = false) {
    if (!oAddress.trim() || (oLat === 0 && oLng === 0)) {
      setConfirmedDest(dest)
      switchMode('origin')
      return
    }
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
      if (useReplace) router.replace(`/select-ride?${params.toString()}`)
      else             router.push(`/select-ride?${params.toString()}`)
    } catch {
      setResolving(false)
    }
  }

  // Confirm a destination — auto-navigates if origin is set
  function confirmDest(lat: number, lng: number, address: string) {
    setConfirmedDest({ lat, lng, address })
    setQuery('')
    setSuggestions([])
    setSearching(false)
    if (originAddress.trim() !== '') {
      void navigateToRide({ lat, lng, address })
    } else {
      switchMode('origin')
    }
  }

  async function selectDestinationSuggestion(s: PlaceSuggestion) {
    setResolving(true)
    try {
      const detail = await geoApi.placeDetails(s.placeId)
      // keep resolving=true — confirmDest → navigateToRide holds it until navigation
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
      switchMode('destination')
      if (confirmedDest) {
        void navigateToRide(confirmedDest, detail.latitude, detail.longitude, detail.address)
      } else {
        setResolving(false)
      }
    } catch {
      setResolving(false)
    }
  }

  function goToMapPicker() {
    const params = new URLSearchParams()
    params.set('mode', mode)
    if (mode === 'destination') {
      // pass origin through so confirm-pickup can echo it back to search
      if (originLat !== 0)  params.set('originLat',     String(originLat))
      if (originLng !== 0)  params.set('originLng',     String(originLng))
      if (originAddress)    params.set('originAddress', originAddress)
      // center map on confirmed dest if exists, otherwise on origin
      const cLat = confirmedDest?.lat ?? originLat
      const cLng = confirmedDest?.lng ?? originLng
      if (cLat !== 0 || cLng !== 0) { params.set('centerLat', String(cLat)); params.set('centerLng', String(cLng)) }
    } else {
      if (originLat !== 0 || originLng !== 0) {
        params.set('centerLat', String(originLat))
        params.set('centerLng', String(originLng))
      }
    }
    router.push(`/confirm-pickup?${params.toString()}`)
  }

  // In origin mode, only show suggestions after the user has actually typed (not the pre-populated address)
  const showSuggestions = query.length >= 2 && (mode === 'destination' || originTouched.current)
  const bothConfirmed   = confirmedDest !== null

  return (
    <div className="h-full flex flex-col bg-background relative">

      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-white pt-safe-top">
        <div className="flex items-center gap-3 px-4 pt-2.5 pb-2">
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
              <User size={11} strokeWidth={2} style={{ color: ICON_CLR }} />
            </span>
            <span className="text-xs font-semibold text-text-primary">For me</span>
            <ChevronDown size={13} className="text-text-muted" strokeWidth={2.2} />
          </motion.button>
        </div>

        {/* Unified from → to card */}
        <div className="mx-4 mb-2 rounded-xl overflow-hidden border border-slate-100 bg-white shadow-sm">
          <div className="flex items-stretch">

            {/* Left section: fixed-width so left-1/2 = exact dot center */}
            <div className="relative flex flex-col w-10 flex-shrink-0">
              <div className="flex-1 flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 relative z-10" />
              </div>
              <div
                className="absolute left-1/2 -translate-x-1/2 w-px"
                style={{
                  top: '25%', bottom: '25%',
                  background: 'repeating-linear-gradient(to bottom, #CBD5E1 0px, #CBD5E1 4px, transparent 4px, transparent 8px)',
                }}
              />
              <div className="flex-1 flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500 relative z-10" />
              </div>
            </div>

            {/* Input column */}
            <div className="flex-1 min-w-0">
              {/* FROM row — single line, no label */}
              <motion.button
                onClick={() => { if (mode !== 'origin') switchMode('origin') }}
                className="w-full text-left px-3 py-2.5 border-b border-border"
                whileTap={{ scale: 0.99 }} transition={SPRING}
              >
                {mode === 'origin' ? (
                  <div className="flex items-center gap-1">
                    <input
                      ref={originInputRef}
                      value={query}
                      onChange={e => handleQueryChange(e.target.value)}
                      placeholder="Enter your pickup"
                      className="flex-1 bg-transparent text-[14px] font-semibold text-text-primary placeholder:text-text-muted placeholder:font-normal outline-none"
                      disabled={resolving}
                    />
                    {searching && <Loader2 size={13} className="text-primary animate-spin flex-shrink-0" />}
                    {query && !searching && (
                      <motion.button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); setQuery(''); setSuggestions([]) }}
                        whileTap={{ scale: 0.85 }}
                        className="w-6 h-6 flex items-center justify-center"
                      >
                        <X size={12} className="text-text-muted" />
                      </motion.button>
                    )}
                  </div>
                ) : (
                  <p className={`text-[14px] truncate ${gpsReady && originAddress ? 'font-semibold text-text-primary' : 'font-normal text-text-muted'}`}>
                    {!gpsReady ? 'Detecting location…' : (originAddress || 'Set pickup location')}
                  </p>
                )}
              </motion.button>

              {/* TO row — single line, no label */}
              <div
                className="px-3 py-2.5 cursor-text"
                onClick={() => {
                  if (confirmedDest) {
                    setConfirmedDest(null); switchMode('destination')
                  } else if (mode !== 'destination') {
                    switchMode('destination')
                  }
                }}
              >
                {confirmedDest ? (
                  <div className="flex items-center gap-1">
                    <p className="text-[14px] font-semibold text-text-primary truncate flex-1">{confirmedDest.address}</p>
                    <motion.button
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); setConfirmedDest(null); switchMode('destination') }}
                      whileTap={{ scale: 0.85 }}
                      className="w-6 h-6 flex items-center justify-center flex-shrink-0"
                    >
                      <X size={12} className="text-text-muted" />
                    </motion.button>
                  </div>
                ) : mode === 'destination' ? (
                  <div className="flex items-center gap-1">
                    <input
                      ref={destInputRef}
                      value={query}
                      onChange={e => handleQueryChange(e.target.value)}
                      placeholder="Where to?"
                      className="flex-1 bg-transparent text-[14px] font-semibold text-text-primary placeholder:text-text-muted placeholder:font-normal outline-none"
                      disabled={resolving}
                    />
                    {searching && <Loader2 size={13} className="text-primary animate-spin flex-shrink-0" />}
                    {query && !searching && (
                      <motion.button
                        onClick={() => { setQuery(''); setSuggestions([]) }}
                        whileTap={{ scale: 0.85 }}
                        className="w-6 h-6 flex items-center justify-center"
                      >
                        <X size={12} className="text-text-muted" />
                      </motion.button>
                    )}
                  </div>
                ) : (
                  <p className="text-[14px] text-text-muted font-normal">Where to?</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Pinned action pills — always fixed, never scroll */}
        <div className="flex gap-2 px-4 pb-1.5">
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

        {/* Sweep loader — clean violet bar bouncing edge to edge */}
        <AnimatePresence>
          {resolving && (
            <motion.div
              className="pb-2"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="relative h-[2px] overflow-hidden bg-slate-200">
                <motion.div
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    width: '40%',
                    background: 'linear-gradient(90deg, transparent, #7C3AED 40%, #7C3AED 60%, transparent)',
                  }}
                  initial={{ left: '-40%' }}
                  animate={{ left: '100%' }}
                  transition={{ duration: 1.0, ease: [0.4, 0, 0.6, 1], repeat: Infinity, repeatType: 'mirror' }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hairline divider — separates fixed header from scrollable body */}
        <div className="h-px bg-slate-100" />
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-2 pb-4 relative bg-white">

        {/* Autocomplete suggestions — only when typing; animate since data is live */}
        {showSuggestions && (
          <motion.div variants={listStagger} initial="hidden" animate="show" key={`ac-${mode}`}>
            {suggestions.length === 0 && !searching ? (
              <motion.p variants={fadeUp} className="text-center text-sm text-text-muted py-10">
                Nothing found. Try a different search.
              </motion.p>
            ) : (
              <div className="mt-1">
                {suggestions.map((s, i) => (
                  <div key={s.placeId}>
                    <motion.button
                      onClick={() => mode === 'origin' ? selectOriginSuggestion(s) : selectDestinationSuggestion(s)}
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

        {/* Popular list — single mounted instance, NEVER re-animates on mode switch */}
        {!showSuggestions && (
          <div>
            {POPULAR.map((d, i) => (
              <div key={d.label}>
                <motion.button
                  onClick={() => mode === 'origin'
                    ? (setOriginLat(d.lat), setOriginLng(d.lng), setOriginAddress(d.address), switchMode('destination'))
                    : confirmDest(d.lat, d.lng, d.address)
                  }
                  className="w-full flex items-center gap-3 px-1 py-3 text-left"
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
