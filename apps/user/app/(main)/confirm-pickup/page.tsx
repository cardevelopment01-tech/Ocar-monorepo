'use client'

import { Suspense, useState, useRef, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowLeft, Navigation2, Loader2, MapPin } from 'lucide-react'
import dynamic from 'next/dynamic'
import { geoApi } from '@/lib/geo-api'

const MapViewInner       = dynamic(() => import('@/components/ui/MapViewInner'),       { ssr: false })
const MapCenterTracker   = dynamic(() => import('@/components/map/MapCenterTracker'),   { ssr: false })

const EASE   = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

function ConfirmPickupContent() {
  const router = useRouter()
  const sp     = useSearchParams()

  const initLat = parseFloat(sp.get('centerLat') ?? '') || DEFAULT_LAT
  const initLng = parseFloat(sp.get('centerLng') ?? '') || DEFAULT_LNG

  const [centerLat,  setCenterLat]  = useState(initLat)
  const [centerLng,  setCenterLng]  = useState(initLng)
  const [address,    setAddress]    = useState<string | null>(null)
  const [geocoding,  setGeocoding]  = useState(false)
  const [confirming, setConfirming] = useState(false)

  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initial reverse-geocode for the starting position
  useEffect(() => {
    setGeocoding(true)
    geoApi.reverseGeocode(initLat, initLng)
      .then(addr => setAddress(addr))
      .catch(() => setAddress(null))
      .finally(() => setGeocoding(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCenterChange = useCallback((lat: number, lng: number) => {
    setCenterLat(lat)
    setCenterLng(lng)
    setAddress(null)
    setGeocoding(true)
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current)
    geocodeTimer.current = setTimeout(() => {
      geoApi.reverseGeocode(lat, lng)
        .then(addr => setAddress(addr))
        .catch(() => setAddress(null))
        .finally(() => setGeocoding(false))
    }, 400)
  }, [])

  async function handleConfirm() {
    if (!address) return
    setConfirming(true)
    // Navigate back to search with the confirmed pickup
    const params = new URLSearchParams({
      originLat:     String(centerLat),
      originLng:     String(centerLng),
      originAddress: address,
    })
    router.push(`/search?${params.toString()}`)
  }

  return (
    <div className="h-full flex flex-col bg-background relative overflow-hidden">

      {/* ── Full-screen map ── */}
      <div className="absolute inset-0">
        <Suspense fallback={<div className="w-full h-full bg-surface-2 animate-pulse" />}>
          <MapViewInner center={[initLat, initLng]} zoom={16}>
            <MapCenterTracker onCenterChange={handleCenterChange} />
          </MapViewInner>
        </Suspense>
      </div>

      {/* ── Center-locked pin (fixed in viewport, map pans underneath) ── */}
      <div
        className="absolute inset-0 pointer-events-none flex items-center justify-center"
        style={{ zIndex: 10 }}
      >
        <div className="relative flex flex-col items-center" style={{ marginTop: -36 }}>
          {/* Pin icon */}
          <motion.div
            animate={geocoding ? { y: [-4, 0, -4] } : { y: 0 }}
            transition={geocoding ? { duration: 0.6, repeat: Infinity, ease: 'easeInOut' } : {}}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg"
              style={{ background: '#4F46E5' }}
            >
              <Navigation2 size={18} className="text-white" strokeWidth={2.5} />
            </div>
          </motion.div>
          {/* Pin stem + shadow */}
          <div className="w-0.5 h-4 bg-primary opacity-60" />
          <div className="w-3 h-1 rounded-full bg-black/20" />
        </div>
      </div>

      {/* ── Back button (top-left) ── */}
      <div className="absolute top-0 left-0 right-0 px-4 pt-safe-top" style={{ zIndex: 20 }}>
        <div className="flex items-center pt-3">
          <motion.button
            onClick={() => router.back()}
            className="w-10 h-10 rounded-full bg-surface shadow-card flex items-center justify-center"
            whileTap={{ scale: 0.88 }} transition={SPRING}
          >
            <ArrowLeft size={18} className="text-text-primary" strokeWidth={2} />
          </motion.button>
        </div>
      </div>

      {/* ── Top instruction pill ── */}
      <div className="absolute top-16 left-0 right-0 flex justify-center" style={{ zIndex: 20 }}>
        <div className="bg-surface rounded-full shadow-card px-5 py-2.5">
          <p className="text-sm font-semibold text-text-primary">Move map to set pickup</p>
        </div>
      </div>

      {/* ── Bottom confirm card ── */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl px-5 pt-5 pb-10"
        style={{ zIndex: 20, boxShadow: '0 -4px 32px rgba(15,15,35,0.12)' }}
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, delay: 0.15 }}
      >
        <div className="w-10 h-1 bg-border rounded-full mx-auto mb-4" />

        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-2">Pickup location</p>

        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-primary-subtle flex items-center justify-center flex-shrink-0 mt-0.5">
            {geocoding
              ? <Loader2 size={15} className="text-primary animate-spin" />
              : <MapPin size={15} className="text-primary" strokeWidth={1.8} />
            }
          </div>
          <div className="flex-1 min-w-0">
            {geocoding || !address ? (
              <div className="space-y-1.5">
                <div className="h-3.5 w-48 bg-surface-2 rounded animate-pulse" />
                <div className="h-3 w-32 bg-surface-2 rounded animate-pulse" />
              </div>
            ) : (
              <p className="text-sm font-semibold text-text-primary leading-snug">{address}</p>
            )}
          </div>
        </div>

        <motion.button
          onClick={handleConfirm}
          disabled={!address || geocoding || confirming}
          className="btn-primary w-full"
          whileTap={{ scale: 0.97 }}
          transition={SPRING}
        >
          {confirming ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> Setting pickup…
            </span>
          ) : 'Confirm pickup location'}
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
