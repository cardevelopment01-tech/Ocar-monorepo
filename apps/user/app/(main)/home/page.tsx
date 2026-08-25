'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { useNotifications } from '@/lib/notifications-context'
import { useLocation } from '@/lib/location-context'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Bell, User,
  Home, Briefcase, Car, RotateCcw, Clock,
  ChevronRight, ArrowRight, MapPin,
} from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import OcarLogoMark from '@/components/ui/OcarLogoMark'
import { geoApi } from '@/lib/geo-api'
import { rideApi, type RideHistoryItem } from '@/lib/ride-api'

// ─── constants ────────────────────────────────────────────────────────────────

const EASE   = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

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
  { id: 'rental',     Icon: Clock,     label: 'City Rides', sub: 'Within city · hourly'   },
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
  const { unreadCount } = useNotifications()
  const name     = user?.name?.split(' ')[0] ?? 'there'

  // GPS was already requested as early as the app can run JS (root layout,
  // before this page even mounted) — read the shared result instead of
  // firing a second independent geolocation request here.
  const { lat, lng, address: addr, cityId: originCityId, ensureFresh } = useLocation()
  const [collapsed,   setCollapsed]   = useState(false)
  const [resolving,   setResolving]   = useState(false)
  const [recentTrips, setRecentTrips] = useState<RideHistoryItem[]>([])
  const [tripsLoading, setTripsLoading] = useState(true)
  const [resumeRideId, setResumeRideId] = useState<string | null>(null)

  useEffect(() => {
    void rideApi.getHistory(1, 3)
      .then(r => setRecentTrips(r.rides.filter(t => t.status === 'completed').slice(0, 2)))
      .catch(() => {})
      .finally(() => setTripsLoading(false))
  }, [])

  // Fallback for a failed/slow active-ride check in the layout (network blip,
  // rate limit): if one still exists, offer a manual way back in instead of
  // leaving the user stranded on Home with no active-ride UI.
  useEffect(() => {
    void rideApi.getActiveRide().then(res => setResumeRideId(res?.rideId ?? null))
  }, [])

  // No coordinate fallback: when GPS hasn't resolved yet (or failed/denied),
  // omit origin params entirely so /search runs its own GPS detection
  // instead of silently booking from a fake point. Re-checks a stale cached
  // fix before handing it off, so a booking started long after the app
  // landed still starts from where the user actually is now.
  async function toSearch() {
    setResolving(true)
    const fix = await ensureFresh()
    const rLat = fix?.lat ?? lat
    const rLng = fix?.lng ?? lng
    const params = new URLSearchParams()
    if (rLat !== null && rLng !== null) {
      params.set('originLat', String(rLat))
      params.set('originLng', String(rLng))
      params.set('originAddress', addr)
    }
    router.push(`/search?${params.toString()}`)
  }

  async function toOneWay() {
    setResolving(true)
    const fix = await ensureFresh()
    const rLat = fix?.lat ?? lat
    const rLng = fix?.lng ?? lng
    const params = new URLSearchParams({ rideType: 'one_way' })
    if (rLat !== null && rLng !== null) {
      params.set('originLat', String(rLat))
      params.set('originLng', String(rLng))
      params.set('originAddress', addr)
    }
    router.push(`/search?${params.toString()}`)
  }

  // Round trip / rental need a real origin + city id up front (no picker of
  // their own) — if either hasn't resolved yet, send the user through
  // /search instead of booking off a missing/wrong location.
  async function toRoundTrip() {
    setResolving(true)
    const fix = await ensureFresh()
    const rLat = fix?.lat ?? lat
    const rLng = fix?.lng ?? lng
    if (rLat === null || rLng === null || originCityId === null) { router.push('/search'); return }
    router.push(`/round-trip?originLat=${rLat}&originLng=${rLng}&originAddress=${encodeURIComponent(addr)}&originCityId=${originCityId}`)
  }

  async function toRental() {
    setResolving(true)
    const fix = await ensureFresh()
    const rLat = fix?.lat ?? lat
    const rLng = fix?.lng ?? lng
    if (rLat === null || rLng === null || originCityId === null) { router.push('/search'); return }
    router.push(`/rental?originLat=${rLat}&originLng=${rLng}&originAddress=${encodeURIComponent(addr)}&originCityId=${originCityId}`)
  }

  async function toRide(destLabel: string, dLat: number, dLng: number) {
    setResolving(true)
    const fix = await ensureFresh()
    const rLat = fix?.lat ?? lat
    const rLng = fix?.lng ?? lng
    if (rLat === null || rLng === null || originCityId === null) {
      router.push(`/search?destinationQuery=${encodeURIComponent(destLabel)}`)
      return
    }
    try {
      const [route, classification] = await Promise.all([
        geoApi.getRoute(rLat, rLng, dLat, dLng),
        // Classification failure must not block booking, fall back to the
        // safe "outstation" default (same default used for out-of-bounds points)
        geoApi.classifyTrip(rLat, rLng, dLat, dLng).catch(() => null),
      ])
      const params = new URLSearchParams({
        originLat:          String(rLat),
        originLng:          String(rLng),
        originAddress:      addr,
        destinationLat:     String(dLat),
        destinationLng:     String(dLng),
        destinationAddress: destLabel,
        distanceKm:         String(route.distanceKm),
        durationMin:        String(route.durationMin),
        originCityId:       String(originCityId),
      })
      if (route.polyline) params.set('polyline', route.polyline)
      const path = classification?.scope === 'in_city' ? '/rental' : '/trip-type'
      router.push(`${path}?${params.toString()}`)
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
        className="relative flex-shrink-0 px-5 pt-safe-top overflow-hidden bg-primary-dark"
        style={{
          borderBottomLeftRadius:  28,
          borderBottomRightRadius: 28,
        }}
        variants={heroVariants}
        initial="hidden"
        animate={collapsed ? 'collapsed' : 'expanded'}
        transition={{ duration: 0.5, ease: EASE }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.4 }}
          >
            <OcarLogoMark size="sm" />
          </motion.div>
          <motion.div
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.18, duration: 0.4 }}
          >
            <motion.button
              onClick={() => router.push('/notifications')}
              aria-label="Notifications"
              className="relative w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.10)' }}
              whileTap={{ scale: 0.9 }}
              transition={SPRING}
            >
              <Bell size={16} strokeWidth={1.6} color="rgba(255,255,255,0.85)" />
              <AnimatePresence>
                {unreadCount > 0 && (
                  <motion.span
                    key="dot"
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.4 }}
                    transition={SPRING}
                    className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500"
                    style={{ boxShadow: '0 0 0 1.5px #0F0D1A' }}
                  />
                )}
              </AnimatePresence>
            </motion.button>
            <motion.button
              onClick={() => router.push('/profile')}
              aria-label="Profile"
              className="w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.10)' }}
              whileTap={{ scale: 0.9 }}
              transition={SPRING}
            >
              <User size={16} strokeWidth={1.6} color="rgba(255,255,255,0.85)" />
            </motion.button>
          </motion.div>
        </div>

        {/* Greeting, disappears on collapse */}
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

        {/* Search bar, always visible */}
        <motion.button
          onClick={() => toSearch()}
          className="w-full flex items-center gap-3 bg-white rounded-2xl px-4"
          style={{ paddingTop: 14, paddingBottom: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.26)' }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.2, ease: EASE }}
          whileTap={{ scale: 0.97 }}
        >
          <Search size={17} strokeWidth={2} className="text-text-muted flex-shrink-0" />
          <span className="flex-1 text-left text-sm font-medium text-text-muted">Where to?</span>
          <span
            className="text-xs font-semibold text-white rounded-lg bg-primary"
            style={{ padding: '6px 12px' }}
          >
            Go
          </span>
        </motion.button>

        {/* Bottom padding spacer, shrinks when collapsed */}
        <motion.div
          animate={{ height: collapsed ? 14 : 6 }}
          transition={SPRING}
        />
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

          {/* Resume-trip banner: shown when an active ride exists but the
              layout's redirect-on-mount check failed or hasn't landed yet. */}
          {resumeRideId && (
            <motion.button
              onClick={() => router.push(`/ride/${resumeRideId}`)}
              className="w-full flex items-center gap-3 bg-primary rounded-2xl px-4 py-3.5 shadow-ambient"
              variants={section}
              whileTap={{ scale: 0.97 }}
              transition={SPRING}
            >
              <span className="w-2 h-2 rounded-full bg-white flex-shrink-0 animate-pulse" />
              <span className="flex-1 min-w-0 text-left text-sm font-bold text-white">
                Trip in progress — tap to resume
              </span>
              <ArrowRight size={16} className="text-white flex-shrink-0" />
            </motion.button>
          )}

          {/* Services */}
          <motion.div variants={section}>
            <motion.div className="grid grid-cols-3 gap-2.5" variants={sectionList} initial="hidden" animate="show">
              {SERVICES.map(s => (
                <motion.button
                  key={s.id}
                  onClick={
                    s.id === 'rental'    ? toRental :
                    s.id === 'roundtrip' ? toRoundTrip :
                    toOneWay
                  }
                  className="card flex flex-col items-center gap-2 py-4"
                  variants={cardV}
                  whileTap={{ scale: 0.97 }}
                  transition={SPRING}
                >
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary-subtle">
                    <s.Icon size={18} strokeWidth={1.6} className="text-primary" />
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
              className="card p-0 overflow-hidden"
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
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary-subtle">
                    <p.Icon size={15} strokeWidth={1.6} className="text-primary" />
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
          {tripsLoading ? (
            <motion.div variants={section} className="card p-0 overflow-hidden">
              {[0, 1].map(i => (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-4 py-3.5${i === 0 ? ' border-b border-border' : ''}`}
                >
                  <span className="skeleton w-9 h-9 rounded-xl flex-shrink-0" />
                  <span className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <span className="skeleton h-3.5 w-2/3 rounded" />
                    <span className="skeleton h-3 w-1/3 rounded" />
                  </span>
                </div>
              ))}
            </motion.div>
          ) : recentTrips.length > 0 && (
            <motion.div variants={section}>
              <motion.div
                className="card p-0 overflow-hidden"
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
                      onClick={() => {
                        const params = new URLSearchParams({ destinationQuery: label })
                        if (lat !== null && lng !== null) {
                          params.set('originLat', String(lat))
                          params.set('originLng', String(lng))
                          params.set('originAddress', addr)
                        }
                        router.push(`/search?${params.toString()}`)
                      }}
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
                  className="flex-shrink-0 flex items-center gap-2 bg-surface border border-border rounded-full px-4 py-2.5 shadow-ambient"
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.07, duration: 0.32, ease: EASE }}
                  whileTap={{ scale: 0.97 }}
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
              className="card w-full text-left flex items-center justify-between gap-4"
              whileTap={{ scale: 0.97 }}
              transition={SPRING}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-text-primary leading-snug">20% off your first ride</p>
                <p className="text-xs text-text-muted mt-0.5">New to Ocar? Use code at checkout</p>
                <div className="inline-flex items-center mt-2.5 rounded-lg px-3 py-1.5 bg-primary-subtle">
                  <span className="text-[11px] font-bold tracking-widest text-primary-dark">OCAR20</span>
                </div>
              </div>
              <span className="text-3xl leading-none flex-shrink-0">🎉</span>
            </motion.button>
          </motion.div>

        </div>
      </motion.div>
    </div>
  )
}
