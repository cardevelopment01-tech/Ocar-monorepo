'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowLeft, Car, RotateCcw, Sparkles } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import AnimatedNumber from '@/components/ui/AnimatedNumber'
import { rideApi, type FareEstimate } from '@/lib/ride-api'

// ─── constants ────────────────────────────────────────────────────────────────

const EASE  = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

const HERO_BG  = 'linear-gradient(160deg, #0F0F23 0%, #1E1B4B 100%)'
const ICON_BG  = '#F1F0FE'
const ICON_CLR = '#4F46E5'

// Representative category for the headline estimate, actual vehicle is chosen on the next screen
const ESTIMATE_CATEGORY_ID = 2
const ROUND_TRIP_MIN_HOURS = 4

const sectionList = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
}
const cardV = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show:   { opacity: 1, y: 0, scale: 1, transition: { duration: 0.36, ease: EASE } },
}

function TripTypeContent() {
  const router = useRouter()
  const sp     = useSearchParams()

  const originLat          = parseFloat(sp.get('originLat') ?? '')
  const originLng          = parseFloat(sp.get('originLng') ?? '')
  const originAddress      = sp.get('originAddress') ?? 'Pickup location'
  const destinationLat     = parseFloat(sp.get('destinationLat') ?? '')
  const destinationLng     = parseFloat(sp.get('destinationLng') ?? '')
  const destinationAddress = sp.get('destinationAddress') ?? 'Destination'
  const distanceKm         = parseFloat(sp.get('distanceKm') ?? '0')
  const durationMin        = parseFloat(sp.get('durationMin') ?? '0')
  const originCityId       = parseInt(sp.get('originCityId') ?? '1', 10)
  const polyline           = sp.get('polyline') ?? undefined
  const scheduledFor       = sp.get('scheduledFor') ?? undefined

  const [oneWayEst,   setOneWayEst]   = useState<FareEstimate | null>(null)
  const [roundTripEst, setRoundTripEst] = useState<FareEstimate | null>(null)
  const [loading, setLoading] = useState(true)

  const hasOrigin = !isNaN(originLat) && !isNaN(originLng)

  useEffect(() => {
    if (!hasOrigin) router.replace('/home')
  }, [hasOrigin, router])

  useEffect(() => {
    if (!hasOrigin) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      rideApi.getEstimate({
        categoryId: ESTIMATE_CATEGORY_ID, rideType: 'one_way',
        distanceKm, durationMin, originCityId,
      }).catch(() => null),
      rideApi.getEstimate({
        categoryId: ESTIMATE_CATEGORY_ID, rideType: 'round_trip',
        distanceKm, durationMin, tripHours: ROUND_TRIP_MIN_HOURS, originCityId,
      }).catch(() => null),
    ]).then(([ow, rt]) => {
      if (cancelled) return
      setOneWayEst(ow)
      setRoundTripEst(rt)
      setLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cheaperOneWay = oneWayEst && roundTripEst && oneWayEst.breakdown.total <= roundTripEst.breakdown.total

  function baseParams() {
    const params = new URLSearchParams({
      originLat:          String(originLat),
      originLng:          String(originLng),
      originAddress,
      destinationLat:     String(destinationLat),
      destinationLng:     String(destinationLng),
      destinationAddress,
      distanceKm:         String(distanceKm),
      durationMin:        String(durationMin),
      originCityId:       String(originCityId),
    })
    if (polyline) params.set('polyline', polyline)
    if (scheduledFor) params.set('scheduledFor', scheduledFor)
    return params
  }

  function chooseOneWay() {
    const params = baseParams()
    params.set('rideType', 'one_way')
    router.push(`/select-ride?${params.toString()}`)
  }

  function chooseRoundTrip() {
    const params = baseParams()
    router.push(`/round-trip?${params.toString()}`)
  }

  if (!hasOrigin) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <OcarSpinner size={32} variant="mono" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background relative overflow-hidden">

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div
        className="relative flex-shrink-0 px-5 pt-safe-top pb-6 overflow-hidden"
        style={{ background: HERO_BG, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}
      >
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
          <motion.div
            className="absolute rounded-full"
            style={{
              width: 220, height: 220, top: -70, right: -50,
              background: 'radial-gradient(circle, rgba(99,102,241,0.45) 0%, transparent 68%)',
              filter: 'blur(48px)',
            }}
            animate={{ x: [0, 18, -8, 0], y: [0, -14, 8, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute rounded-full"
            style={{
              width: 180, height: 180, bottom: -60, left: -30,
              background: 'radial-gradient(circle, rgba(124,58,237,0.40) 0%, transparent 68%)',
              filter: 'blur(42px)',
            }}
            animate={{ x: [0, -12, 16, 0], y: [0, 10, -10, 0] }}
            transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
          />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-5">
            <motion.button
              onClick={() => router.back()}
              aria-label="Go back"
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.10)' }}
              whileTap={{ scale: 0.88 }} transition={SPRING}
            >
              <ArrowLeft size={16} strokeWidth={2} color="rgba(255,255,255,0.85)" />
            </motion.button>
            <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>
              This trip goes outside the city
            </span>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.1 }}
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
              <p className="text-[13px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.75)' }}>{originAddress}</p>
            </div>
            <div className="ml-[3px] my-1 w-px h-3" style={{ background: 'rgba(255,255,255,0.20)' }} />
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              <p className="text-[15px] font-bold truncate text-white">{destinationAddress}</p>
            </div>
            {distanceKm > 0 && (
              <p className="text-xs font-medium mt-3" style={{ color: 'rgba(255,255,255,0.48)' }}>
                {Math.round(distanceKm)} km · {Math.round(durationMin)} min drive
              </p>
            )}
          </motion.div>
        </div>
      </div>

      {/* ── Options ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-5 pb-8">
        <motion.div
          className="flex flex-col gap-3.5"
          variants={sectionList} initial="hidden" animate="show"
        >
          {/* One Way */}
          <motion.button
            onClick={chooseOneWay}
            variants={cardV}
            whileTap={{ scale: 0.97 }}
            className="relative w-full text-left rounded-3xl p-5 bg-white overflow-hidden"
            style={{
              border: '1px solid #EEF0FA',
              boxShadow: '0 10px 34px rgba(15,15,35,0.09)',
            }}
          >
            {cheaperOneWay && (
              <span
                className="absolute top-4 right-4 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full"
                style={{ background: '#ECFDF5', color: '#059669' }}
              >
                <Sparkles size={10} /> BEST FARE
              </span>
            )}
            <div className="flex items-center gap-3 mb-3">
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: ICON_BG }}>
                <Car size={19} strokeWidth={1.7} style={{ color: ICON_CLR }} />
              </span>
              <div>
                <p className="text-[15px] font-bold text-text-primary">One Way</p>
                <p className="text-[11px] text-text-muted">Fastest way to get there</p>
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              {loading ? (
                <div className="h-7 w-20 rounded-lg bg-slate-100 animate-pulse" />
              ) : oneWayEst ? (
                <>
                  <span className="text-[22px] font-black text-text-primary tabular-nums">
                    ₹<AnimatedNumber value={Math.round(oneWayEst.breakdown.total)} />
                  </span>
                  <span className="text-[11px] text-text-muted font-medium">one way</span>
                </>
              ) : (
                <span className="text-sm text-text-muted">Fare unavailable</span>
              )}
            </div>
          </motion.button>

          {/* Round Trip */}
          <motion.button
            onClick={chooseRoundTrip}
            variants={cardV}
            whileTap={{ scale: 0.97 }}
            className="relative w-full text-left rounded-3xl p-5 bg-white overflow-hidden"
            style={{
              border: '1px solid #EEF0FA',
              boxShadow: '0 10px 34px rgba(15,15,35,0.09)',
            }}
          >
            {roundTripEst && !cheaperOneWay && (
              <span
                className="absolute top-4 right-4 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full"
                style={{ background: '#ECFDF5', color: '#059669' }}
              >
                <Sparkles size={10} /> BEST FARE
              </span>
            )}
            <div className="flex items-center gap-3 mb-3">
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: ICON_BG }}>
                <RotateCcw size={18} strokeWidth={1.7} style={{ color: ICON_CLR }} />
              </span>
              <div>
                <p className="text-[15px] font-bold text-text-primary">Round Trip</p>
                <p className="text-[11px] text-text-muted">Driver waits and brings you back</p>
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              {loading ? (
                <div className="h-7 w-24 rounded-lg bg-slate-100 animate-pulse" />
              ) : roundTripEst ? (
                <>
                  <span className="text-[22px] font-black text-text-primary tabular-nums">
                    ₹<AnimatedNumber value={Math.round(roundTripEst.breakdown.total)} />
                  </span>
                  <span className="text-[11px] text-text-muted font-medium">from · {ROUND_TRIP_MIN_HOURS}h min</span>
                </>
              ) : (
                <span className="text-sm text-text-muted">Fare unavailable</span>
              )}
            </div>
          </motion.button>
        </motion.div>
      </div>
    </div>
  )
}

export default function TripTypePage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center bg-background">
        <OcarSpinner size={32} variant="color" />
      </div>
    }>
      <TripTypeContent />
    </Suspense>
  )
}
