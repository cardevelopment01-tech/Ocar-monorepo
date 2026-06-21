'use client'

import { Suspense, useState, useRef, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowLeft, Navigation2, Loader2, MapPin, LocateFixed } from 'lucide-react'
import dynamic from 'next/dynamic'
import { geoApi } from '@/lib/geo-api'

const MapViewInner       = dynamic(() => import('@/components/ui/MapViewInner'),       { ssr: false })
const MapCenterTracker   = dynamic(() => import('@/components/map/MapCenterTracker'),   { ssr: false })
const FlyTo              = dynamic(() => import('@/components/map/FlyTo'),              { ssr: false })

const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

function ConfirmPickupContent() {
  const router = useRouter()
  const sp     = useSearchParams()

  const pickerMode = sp.get('mode') ?? 'origin'   // 'origin' | 'destination'
  const isDest     = pickerMode === 'destination'

  // origin passthrough — only used when mode=destination so we can return it to search
  const ptOriginLat  = sp.get('originLat')     ?? ''
  const ptOriginLng  = sp.get('originLng')     ?? ''
  const ptOriginAddr = sp.get('originAddress') ?? ''

  const initLat = parseFloat(sp.get('centerLat') ?? '') || DEFAULT_LAT
  const initLng = parseFloat(sp.get('centerLng') ?? '') || DEFAULT_LNG

  const [centerLat,  setCenterLat]  = useState(initLat)
  const [centerLng,  setCenterLng]  = useState(initLng)
  const [address,    setAddress]    = useState<string | null>(null)
  const [geocoding,  setGeocoding]  = useState(false)
  const [dragging,   setDragging]   = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [locating,   setLocating]   = useState(false)
  const [flyTarget,  setFlyTarget]  = useState<[number, number] | null>(null)

  const geocodeTimer       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGeocodedPos    = useRef<{ lat: number; lng: number } | null>(null)

  // Initial reverse-geocode for the starting position
  useEffect(() => {
    setGeocoding(true)
    geoApi.reverseGeocode(initLat, initLng)
      .then(addr => {
        setAddress(addr)
        lastGeocodedPos.current = { lat: initLat, lng: initLng }
      })
      .catch(() => setAddress(null))
      .finally(() => setGeocoding(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDragStart = useCallback(() => {
    setDragging(true)
  }, [])

  const handleCenterChange = useCallback((lat: number, lng: number) => {
    setDragging(false)
    setCenterLat(lat)
    setCenterLng(lng)

    // Skip geocode if map hasn't moved meaningfully (e.g. zoom-only)
    const last = lastGeocodedPos.current
    if (last && haversineM(last.lat, last.lng, lat, lng) < 30) return

    setGeocoding(true)
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current)
    geocodeTimer.current = setTimeout(() => {
      geoApi.reverseGeocode(lat, lng)
        .then(addr => {
          setAddress(addr)
          lastGeocodedPos.current = { lat, lng }
        })
        .catch(() => {})
        .finally(() => setGeocoding(false))
    }, 400)
  }, [])

  function locateMe() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords
        setFlyTarget([latitude, longitude])
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  async function handleConfirm() {
    if (!address) return
    setConfirming(true)
    try {
      const params = new URLSearchParams()
      if (isDest) {
        params.set('destinationLat',     String(centerLat))
        params.set('destinationLng',     String(centerLng))
        params.set('destinationAddress', address)
        if (ptOriginLat)  params.set('originLat',     ptOriginLat)
        if (ptOriginLng)  params.set('originLng',     ptOriginLng)
        if (ptOriginAddr) params.set('originAddress', ptOriginAddr)
      } else {
        params.set('originLat',     String(centerLat))
        params.set('originLng',     String(centerLng))
        params.set('originAddress', address)
      }
      router.replace(`/search?${params.toString()}`)
    } finally {
      setConfirming(false)
    }
  }

  const pinLifted = dragging || geocoding

  return (
    <div className="h-full flex flex-col bg-background relative overflow-hidden">

      {/* ── Full-screen map ── */}
      <div className="absolute inset-0">
        <Suspense fallback={<div className="w-full h-full bg-surface-2 animate-pulse" />}>
          <MapViewInner center={[initLat, initLng]} zoom={16}>
            <MapCenterTracker onCenterChange={handleCenterChange} onDragStart={handleDragStart} />
            <FlyTo target={flyTarget} zoom={16} />
          </MapViewInner>
        </Suspense>
      </div>

      {/* ── Center-locked pin (fixed in viewport, map pans underneath) ── */}
      <div
        className="absolute inset-0 pointer-events-none flex items-center justify-center"
        style={{ zIndex: 10 }}
      >
        <div className="relative flex flex-col items-center" style={{ marginTop: -40 }}>
          {/* Pin head + stem animate together */}
          <motion.div
            className="flex flex-col items-center"
            animate={pinLifted ? { y: -8 } : { y: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg"
              style={{ background: '#4F46E5' }}
            >
              {geocoding
                ? <Loader2 size={18} className="text-white animate-spin" />
                : <Navigation2 size={18} className="text-white" strokeWidth={2.5} />
              }
            </div>
            <div className="w-0.5 h-4 bg-primary/60" />
          </motion.div>
          {/* Shadow scales up as pin lifts */}
          <motion.div
            className="rounded-full bg-black/20"
            animate={pinLifted ? { scaleX: 0.6, opacity: 0.4 } : { scaleX: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            style={{ width: 12, height: 4 }}
          />
        </div>
      </div>

      {/* ── Back button (top-left) ── */}
      <div className="absolute top-0 left-0 right-0 px-4 pt-safe-top" style={{ zIndex: 20 }}>
        <div className="flex items-center pt-3">
          <motion.button
            onClick={() => {
              const p = new URLSearchParams()
              if (ptOriginLat)  p.set('originLat',     ptOriginLat)
              if (ptOriginLng)  p.set('originLng',     ptOriginLng)
              if (ptOriginAddr) p.set('originAddress', ptOriginAddr)
              const qs = p.toString()
              router.replace(qs ? `/search?${qs}` : '/search')
            }}
            className="w-11 h-11 rounded-full bg-surface shadow-card flex items-center justify-center"
            whileTap={{ scale: 0.88 }} transition={SPRING}
          >
            <ArrowLeft size={18} className="text-text-primary" strokeWidth={2} />
          </motion.button>
        </div>
      </div>

      {/* ── Top instruction pill ── */}
      <div className="absolute top-16 left-0 right-0 flex justify-center" style={{ zIndex: 20 }}>
        <div className="bg-surface rounded-full shadow-card px-5 py-2.5">
          <p className="text-sm font-semibold text-text-primary">
            {dragging ? 'Drag to position…' : isDest ? 'Move map to set destination' : 'Move map to set pickup'}
          </p>
        </div>
      </div>

      {/* ── Locate Me FAB ── */}
      <div className="absolute bottom-52 right-4" style={{ zIndex: 20 }}>
        <motion.button
          onClick={locateMe}
          disabled={locating}
          className="w-12 h-12 rounded-full bg-surface shadow-card flex items-center justify-center"
          whileTap={{ scale: 0.88 }} transition={SPRING}
          aria-label="Use current location"
        >
          {locating
            ? <Loader2 size={18} className="text-primary animate-spin" />
            : <LocateFixed size={18} className="text-primary" strokeWidth={1.8} />
          }
        </motion.button>
      </div>

      {/* ── Bottom confirm card ── */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl px-5 pt-5 pb-10"
        style={{ zIndex: 20, boxShadow: '0 -4px 32px rgba(15,15,35,0.12)' }}
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, delay: 0.15 }}
      >
        <div className="w-9 h-[5px] bg-gray-300 rounded-full mx-auto mb-4" />

        <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest mb-2">{isDest ? 'Destination' : 'Pickup location'}</p>

        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-primary-subtle flex items-center justify-center flex-shrink-0 mt-0.5">
            {geocoding
              ? <Loader2 size={15} className="text-primary animate-spin" />
              : <MapPin size={15} className="text-primary" strokeWidth={1.8} />
            }
          </div>
          <div className="flex-1 min-w-0">
            {!address ? (
              <div className="space-y-1.5">
                <div className="h-3.5 w-48 bg-surface-2 rounded animate-pulse" />
                <div className="h-3 w-32 bg-surface-2 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-text-primary leading-snug">{address}</p>
                {geocoding && (
                  <p className="text-xs text-text-muted mt-0.5">Updating…</p>
                )}
              </div>
            )}
          </div>
        </div>

        <motion.button
          onClick={handleConfirm}
          disabled={!address || confirming}
          className="btn-primary w-full"
          whileTap={{ scale: 0.97 }}
          transition={SPRING}
        >
          {confirming ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> {isDest ? 'Setting destination…' : 'Setting pickup…'}
            </span>
          ) : isDest ? 'Confirm destination' : 'Confirm pickup location'}
        </motion.button>
      </motion.div>
    </div>
  )
}

export default function ConfirmPickupPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" />
      </div>
    }>
      <ConfirmPickupContent />
    </Suspense>
  )
}
