'use client'

import { useRef, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Search, Bell, User,
  Home, Briefcase, Car, RotateCcw, Clock,
  ChevronRight, ArrowRight, MapPin,
} from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { geoApi } from '@/lib/geo-api'
import { rideApi, type RideHistoryItem } from '@/lib/ride-api'

// ─── constants ────────────────────────────────────────────────────────────────

const EASE   = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

const HERO_BG  = 'linear-gradient(160deg, #0F0F23 0%, #1E1B4B 100%)'
const ICON_BG  = '#F1F0FE'
const ICON_CLR = '#4F46E5'
const SHADOW   = '0 2px 12px rgba(15,15,35,0.07)'

// Fixed positions for particles — no Math.random() to avoid hydration mismatch
const PARTICLES = [
  { top: '16%', left: '9%',  delay: 0,   dur: 2.6 },
  { top: '28%', left: '80%', delay: 0.9, dur: 3.2 },
  { top: '55%', left: '24%', delay: 1.8, dur: 2.4 },
  { top: '70%', left: '68%', delay: 0.4, dur: 3.8 },
  { top: '12%', left: '52%', delay: 2.1, dur: 2.9 },
  { top: '82%', left: '42%', delay: 1.3, dur: 3.4 },
  { top: '44%', left: '91%', delay: 0.6, dur: 2.7 },
  { top: '90%', left: '15%', delay: 2.5, dur: 3.1 },
]

// ─── motion variants ──────────────────────────────────────────────────────────

// Hero collapses: hidden → expanded → collapsed
const heroVariants = {
  hidden:    { opacity: 0, y: -24 },
  expanded:  { opacity: 1, y: 0 },
  collapsed: { opacity: 1, y: 0 },
}

const section = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.36, ease: EASE } },
}
const sectionList = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.07 } },
}
const row = {
  hidden: { opacity: 0, x: -8 },
  show:   { opacity: 1, x: 0, transition: { duration: 0.27, ease: EASE } },
}
const cardV = {
  hidden: { opacity: 0, scale: 0.94 },
  show:   { opacity: 1, scale: 1,   transition: { duration: 0.28, ease: EASE } },
}
const page = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.08, delayChildren: 0.3 } },
}

// ─── data ─────────────────────────────────────────────────────────────────────

const SERVICES = [
  { id: 'oneway',     Icon: Car,       label: 'One Way',    sub: 'One way · best fare'    },
  { id: 'roundtrip',  Icon: RotateCcw, label: 'Round Trip', sub: 'Driver stays with you'  },
  { id: 'rental',     Icon: Clock,     label: 'Rental',     sub: 'Within city · hourly'   },
]
const SAVED = [
  { Icon: Home,      label: 'Home', sub: 'Sahid Nagar, Bhubaneswar',   lat: 20.2929, lng: 85.8363 },
  { Icon: Briefcase, label: 'Work', sub: 'Infocity, Chandrasekharpur', lat: 20.3506, lng: 85.8110 },
]
const POPULAR = [
  { from: 'Bhubaneswar', to: 'Cuttack',     lat: 20.4625, lng: 85.8830 },
  { from: 'Bhubaneswar', to: 'Puri',        lat: 19.8010, lng: 85.8210 },
  { from: 'Cuttack',     to: 'Bhubaneswar', lat: 20.2961, lng: 85.8245 },
  { from: 'Puri',        to: 'Bhubaneswar', lat: 20.2961, lng: 85.8245 },
]

// ─── helpers ──────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// ─── component ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router   = useRouter()
  const { user } = useAuth()
  const name     = user?.name?.split(' ')[0] ?? 'there'
  const reduce   = useReducedMotion()

  const [addr,        setAddr]        = useState('Bhubaneswar')
  const [lat,         setLat]         = useState(20.2961)
  const [lng,         setLng]         = useState(85.8245)
  const [collapsed,   setCollapsed]   = useState(false)
  const [resolving,   setResolving]   = useState(false)
  const [recentTrips, setRecentTrips] = useState<RideHistoryItem[]>([])
  const fetched = useRef(false)

  useEffect(() => {
    void rideApi.getHistory(1, 3)
      .then(r => setRecentTrips(r.rides.filter(t => t.status === 'completed').slice(0, 2)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (fetched.current || !navigator.geolocation) return
    fetched.current = true
    navigator.geolocation.getCurrentPosition(
      p => {
        setLat(p.coords.latitude)
        setLng(p.coords.longitude)
        geoApi.reverseGeocode(p.coords.latitude, p.coords.longitude)
          .then(address => setAddr(address))
          .catch(() => {})
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000 },
    )
  }, [])

  function toSearch() {
    router.push(`/search?originLat=${lat}&originLng=${lng}&originAddress=${encodeURIComponent(addr)}`)
  }

  function toRoundTrip() {
    router.push(`/round-trip?originLat=${lat}&originLng=${lng}&originAddress=${encodeURIComponent(addr)}&originCityId=1`)
  }

  function toRental() {
    router.push(`/rental?originLat=${lat}&originLng=${lng}&originAddress=${encodeURIComponent(addr)}&originCityId=1`)
  }

  async function toRide(destLabel: string, dLat: number, dLng: number) {
    setResolving(true)
    try {
      const route = await geoApi.getRoute(lat, lng, dLat, dLng)
      const params = new URLSearchParams({
        originLat:          String(lat),
        originLng:          String(lng),
        originAddress:      addr,
        destinationLat:     String(dLat),
        destinationLng:     String(dLng),
        destinationAddress: destLabel,
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

  return (
    <div className="h-full flex flex-col bg-background relative">

      {/* Route-resolve overlay */}
      <AnimatePresence>
        {resolving && (
          <motion.div
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <OcarSpinner size={28} variant="color" />
            <span className="text-sm text-text-secondary font-medium">Getting route…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <motion.div
        className="relative flex-shrink-0 px-5 pt-safe-top overflow-hidden"
        style={{
          background:              HERO_BG,
          borderBottomLeftRadius:  28,
          borderBottomRightRadius: 28,
        }}
        variants={heroVariants}
        initial="hidden"
        animate={collapsed ? 'collapsed' : 'expanded'}
        transition={{ duration: 0.5, ease: EASE }}
      >
        {/* ── Decorative layer ── */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>

          {/* Orb 1 — large indigo blob, top-right */}
          <motion.div
            className="absolute rounded-full"
            style={{
              width: 220, height: 220,
              top: -70, right: -50,
              background: 'radial-gradient(circle, rgba(99,102,241,0.45) 0%, transparent 68%)',
              filter: 'blur(48px)',
            }}
            animate={reduce ? {} : { x: [0, 18, -8, 0], y: [0, -14, 8, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Orb 2 — purple blob, bottom-left */}
          <motion.div
            className="absolute rounded-full"
            style={{
              width: 180, height: 180,
              bottom: -50, left: -30,
              background: 'radial-gradient(circle, rgba(124,58,237,0.40) 0%, transparent 68%)',
              filter: 'blur(42px)',
            }}
            animate={reduce ? {} : { x: [0, -12, 16, 0], y: [0, 10, -10, 0] }}
            transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
          />

          {/* Orb 3 — faint teal accent, mid-right */}
          <motion.div
            className="absolute rounded-full"
            style={{
              width: 120, height: 120,
              top: '40%', right: '10%',
              background: 'radial-gradient(circle, rgba(56,189,248,0.18) 0%, transparent 68%)',
              filter: 'blur(32px)',
            }}
            animate={reduce ? { opacity: 0.6 } : { y: [0, -20, 12, 0], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
          />

          {/* Twinkling particles */}
          {PARTICLES.map((p, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full bg-white"
              style={{ top: p.top, left: p.left, width: 2, height: 2 }}
              animate={reduce ? { opacity: 0.2 } : { opacity: [0.08, 0.55, 0.08], scale: [1, 1.4, 1] }}
              transition={{ duration: p.dur, repeat: Infinity, delay: p.delay, ease: 'easeInOut' }}
            />
          ))}

          {/* Subtle grid overlay */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          />
        </div>

        {/* ── Real content — sits above decorative layer ── */}
        <div className="relative z-10">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <motion.span
            className="text-xl font-black tracking-tight text-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.4 }}
          >
            ocar
          </motion.span>
          <motion.div
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.18, duration: 0.4 }}
          >
            <motion.button
              aria-label="Notifications"
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.10)' }}
              whileTap={{ scale: 0.86 }}
              transition={SPRING}
            >
              <Bell size={16} strokeWidth={1.6} color="rgba(255,255,255,0.85)" />
            </motion.button>
            <motion.button
              onClick={() => router.push('/profile')}
              aria-label="Profile"
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.10)' }}
              whileTap={{ scale: 0.86 }}
              transition={SPRING}
            >
              <User size={16} strokeWidth={1.6} color="rgba(255,255,255,0.85)" />
            </motion.button>
          </motion.div>
        </div>

        {/* Greeting — disappears on collapse */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="greeting"
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
              style={{ overflow: 'hidden' }}
            >
              <motion.p
                className="text-sm font-medium"
                style={{ color: 'rgba(255,255,255,0.48)' }}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22, duration: 0.36, ease: EASE }}
              >
                {greeting()}
              </motion.p>
              <motion.h1
                className="text-2xl font-bold text-white tracking-tight mt-0.5"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.26, duration: 0.36, ease: EASE }}
              >
                {name} 👋
              </motion.h1>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Search bar — always visible */}
        <motion.button
          onClick={() => toSearch()}
          className="w-full flex items-center gap-3 bg-white rounded-2xl px-4"
          style={{ paddingTop: 14, paddingBottom: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.26)' }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: 0.3, duration: 0.45, ease: EASE }}
          whileTap={{ scale: 0.985 }}
        >
          <Search size={17} strokeWidth={2} className="text-text-muted flex-shrink-0" />
          <span className="flex-1 text-left text-sm font-medium text-text-muted">Where to?</span>
          <span
            className="text-xs font-semibold text-white rounded-lg"
            style={{ background: ICON_CLR, padding: '6px 12px' }}
          >
            Go
          </span>
        </motion.button>

        {/* Bottom padding spacer — shrinks when collapsed */}
        <motion.div
          animate={{ height: collapsed ? 14 : 6 }}
          transition={SPRING}
        />

        </div>{/* end relative z-10 */}
      </motion.div>

      {/* ── Content ───────────────────────────────────────────── */}
      <motion.div
        className="flex-1 overflow-y-auto scrollbar-none"
        variants={page}
        initial="hidden"
        animate="show"
        onScroll={(e: React.UIEvent<HTMLDivElement>) => {
          const top = e.currentTarget.scrollTop
          setCollapsed(top > 48)
        }}
      >
        <div className="px-4 pt-4 pb-28 flex flex-col gap-5">

          {/* Services */}
          <motion.div variants={section}>
            <motion.div className="grid grid-cols-3 gap-2.5" variants={sectionList} initial="hidden" animate="show">
              {SERVICES.map(s => (
                <motion.button
                  key={s.id}
                  onClick={
                    s.id === 'rental'    ? toRental :
                    s.id === 'roundtrip' ? toRoundTrip :
                    toSearch
                  }
                  className="flex flex-col items-center gap-2 py-4 bg-surface border border-border rounded-2xl"
                  style={{ boxShadow: SHADOW }}
                  variants={cardV}
                  whileTap={{ scale: 0.93 }}
                  transition={SPRING}
                >
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: ICON_BG }}>
                    <s.Icon size={18} strokeWidth={1.6} style={{ color: ICON_CLR }} />
                  </span>
                  <span className="flex flex-col items-center gap-0.5 text-center">
                    <span className="text-xs font-semibold text-text-primary">{s.label}</span>
                    <span className="text-[10px] text-text-muted">{s.sub}</span>
                  </span>
                </motion.button>
              ))}
            </motion.div>
          </motion.div>

          {/* Saved places */}
          <motion.div variants={section}>
            <motion.div
              className="bg-surface rounded-2xl border border-border overflow-hidden"
              style={{ boxShadow: SHADOW }}
              variants={sectionList} initial="hidden" animate="show"
            >
              {SAVED.map((p, i) => (
                <motion.button
                  key={p.label}
                  onClick={() => toRide(p.sub, p.lat, p.lng)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left${i < SAVED.length - 1 ? ' border-b border-border' : ''}`}
                  variants={row}
                  whileTap={{ backgroundColor: '#F8FAFF' }}
                  transition={SPRING}
                >
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: ICON_BG }}>
                    <p.Icon size={15} strokeWidth={1.6} style={{ color: ICON_CLR }} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-text-primary">{p.label}</span>
                    <span className="block text-xs text-text-muted truncate mt-0.5">{p.sub}</span>
                  </span>
                  <ChevronRight size={14} className="text-text-muted flex-shrink-0" />
                </motion.button>
              ))}
            </motion.div>
          </motion.div>

          {/* Go again */}
          {recentTrips.length > 0 && (
            <motion.div variants={section}>
              <motion.div
                className="bg-surface rounded-2xl border border-border overflow-hidden"
                style={{ boxShadow: SHADOW }}
                variants={sectionList} initial="hidden" animate="show"
              >
                {recentTrips.map((r, i) => {
                  const label = r.destination_address ?? 'Unknown destination'
                  const meta  = r.completed_at
                    ? new Date(r.completed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                    : 'Recent'
                  return (
                    <motion.button
                      key={r.id}
                      onClick={() => toSearch()}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left${i < recentTrips.length - 1 ? ' border-b border-border' : ''}`}
                      variants={row}
                      whileTap={{ backgroundColor: '#F8FAFF' }}
                      transition={SPRING}
                    >
                      <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
                        <MapPin size={14} strokeWidth={1.6} className="text-text-muted" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-text-primary truncate">{label}</span>
                        <span className="block text-xs text-text-muted mt-0.5">{meta}</span>
                      </span>
                      <ChevronRight size={14} className="text-text-muted flex-shrink-0" />
                    </motion.button>
                  )
                })}
              </motion.div>
            </motion.div>
          )}

          {/* Popular routes */}
          <motion.div variants={section}>
            <p className="text-[13px] font-semibold text-text-secondary mb-3">Popular routes</p>
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-0.5 scrollbar-none">
              {POPULAR.map((r, i) => (
                <motion.button
                  key={`${r.from}-${r.to}`}
                  onClick={() => toRide(r.to, r.lat, r.lng)}
                  className="flex-shrink-0 flex items-center gap-2 bg-surface border border-border rounded-full px-4 py-2.5"
                  style={{ boxShadow: SHADOW }}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.07, duration: 0.32, ease: EASE }}
                  whileTap={{ scale: 0.93 }}
                >
                  <span className="text-xs font-medium text-text-secondary whitespace-nowrap">{r.from}</span>
                  <ArrowRight size={10} strokeWidth={2.5} className="text-text-muted flex-shrink-0" />
                  <span className="text-xs font-semibold text-text-primary whitespace-nowrap">{r.to}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>

          {/* Promo */}
          <motion.div variants={section}>
            <motion.button
              className="w-full text-left rounded-2xl px-5 py-5"
              style={{ background: HERO_BG, boxShadow: '0 6px 24px rgba(15,15,35,0.22)' }}
              whileTap={{ scale: 0.985 }}
              transition={SPRING}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-white leading-snug">20% off your first ride</p>
                  <p className="text-xs font-medium mt-1" style={{ color: 'rgba(255,255,255,0.50)' }}>
                    New to Ocar? Use code at checkout
                  </p>
                  <div
                    className="inline-flex items-center mt-3 rounded-lg px-3 py-1.5"
                    style={{ background: 'rgba(255,255,255,0.10)' }}
                  >
                    <span className="text-[11px] font-bold tracking-widest" style={{ color: '#A5B4FC' }}>OCAR20</span>
                  </div>
                </div>
                <span className="text-4xl leading-none flex-shrink-0">🎉</span>
              </div>
            </motion.button>
          </motion.div>

        </div>
      </motion.div>
    </div>
  )
}
