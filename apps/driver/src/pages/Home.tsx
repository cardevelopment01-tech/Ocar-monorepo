import { useEffect, useRef, useState, useMemo, lazy, Suspense } from 'react'
import {
  motion, useReducedMotion,
  useMotionValue, useTransform, useMotionValueEvent, animate,
} from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { IndianRupee, Clock, Star, TrendingUp, Bell, Wallet, ChevronRight } from 'lucide-react'
import OnlineToggle from '@/components/ui/OnlineToggle'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/store/useSessionStore'
import { driverRideApi, type EarningsSummary } from '@/lib/ride-api'
import api from '@/lib/api'
import { disconnectDriverSocket } from '@/lib/socket'

const DriverMapView = lazy(() => import('@/components/map/DriverMapView'))
const RecenterMap   = lazy(() => import('@/components/map/RecenterMap'))
const SelfCarMarker = lazy(() => import('@/components/map/SelfCarMarker'))

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245
const NAV_HEIGHT  = 60

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8000,
    })
  )
}

const GLASS = {
  background:           'rgba(255,255,255,0.92)',
  backdropFilter:       'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border:               '1px solid rgba(79,70,229,0.10)',
  boxShadow:            '0 2px 16px rgba(79,70,229,0.10)',
}

export default function Home() {
  const navigate = useNavigate()
  const driver   = useAuthStore(s => s.driver)
  const { isOnline, sessionId, setOffline } = useSessionStore()
  const prefersReducedMotion = useReducedMotion()

  // ── Refs ────────────────────────────────────────────────────────────────────
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sheetRef            = useRef<HTMLDivElement | null>(null)
  // contentRef wraps inner content (no height constraint) so ResizeObserver
  // sees the natural rendered height even when the outer sheet is clipped.
  const contentRef          = useRef<HTMLDivElement | null>(null)
  // Sentinel placed after the stats row — defines the collapsed snap point.
  const collapseRef         = useRef<HTMLDivElement | null>(null)
  // Active drag: captures start position so we can compute delta on every move.
  const dragRef             = useRef<{ startY: number; startH: number } | null>(null)
  // Holds the in-flight spring animation so we can cancel it on a new drag.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const animRef             = useRef<any>(null)
  // RAF handle for throttling the occlusion state write during drag.
  const rafRef              = useRef<number | null>(null)
  const geoTimer            = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGeoCoord        = useRef<[number, number] | null>(null)

  // ── Motion values ───────────────────────────────────────────────────────────
  // Start large so no content is clipped before the first ResizeObserver fires.
  const sheetH        = useMotionValue(600)
  const handlePressed = useMotionValue(0)

  // ── State ───────────────────────────────────────────────────────────────────
  const [mapCenter,          setMapCenter]         = useState<[number, number]>([DEFAULT_LAT, DEFAULT_LNG])
  const [maxContentH,        setMaxContentH]       = useState(360)
  const [collapsedH,         setCollapsedH]        = useState(240)
  // occlusion drives RecenterMap.bottomPadding — updated via RAF throttle.
  const [occlusion,          setOcclusion]         = useState(420)
  const [areaName,           setAreaName]          = useState<string | null>(null)
  const [geoLoading,         setGeoLoading]        = useState(false)
  const [showOfflineConfirm, setShowOfflineConfirm] = useState(false)
  const [todayEarnings, setTodayEarnings] = useState<EarningsSummary>({
    total_earnings: 0, trip_count: 0, online_hours: '0m', rating: null,
    chart: [], chart_labels: [],
    breakdown: { base_fare: 0, tips: 0, incentives: 0, platform_fee: 0 },
  })

  // ── Snap points ─────────────────────────────────────────────────────────────
  const snaps = useMemo(() => ({
    collapsed: collapsedH,
    peek:      maxContentH,
  }), [collapsedH, maxContentH])

  // ── Handle bar visual feedback ───────────────────────────────────────────────
  // The bar widens and deepens to the brand primary on press — subtle but tactile.
  const handleScaleX = useTransform(handlePressed, [0, 1], [1, 1.65])
  const handleBg     = useTransform(
    handlePressed,
    [0, 1],
    ['rgba(79,70,229,0.15)', 'rgba(79,70,229,0.48)'],
  )

  // ── Sync sheetH → map occlusion (RAF-throttled) ──────────────────────────────
  // Throttles to one setOcclusion per animation frame, preventing RecenterMap
  // from queuing up hundreds of easeTo() calls during a fast drag.
  useMotionValueEvent(sheetH, 'change', (h) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      setOcclusion(Math.round(h) + NAV_HEIGHT)
      rafRef.current = null
    })
  })

  // ── Earnings fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    driverRideApi.getEarningsSummary('today')
      .then(setTodayEarnings)
      .catch(() => {})
  }, [])

  const e         = todayEarnings
  const firstName = driver?.full_name?.split(' ')[0] ?? 'Driver'

  // ── GPS location loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOnline || !sessionId) {
      if (locationIntervalRef.current) { clearInterval(locationIntervalRef.current); locationIntervalRef.current = null }
      return
    }
    const sendLocation = async () => {
      const pos = await getCurrentPosition().catch(() => null)
      if (!pos) return  // never send fake coordinates on GPS failure
      setMapCenter([pos.coords.latitude, pos.coords.longitude])
      await driverRideApi.updateLocation({
        sessionId, lat: pos.coords.latitude, lng: pos.coords.longitude,
        recordedAt: new Date().toISOString(),
      }).catch(() => {})
    }
    void sendLocation()
    locationIntervalRef.current = setInterval(sendLocation, 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void sendLocation() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isOnline, sessionId])

  const handleToggle = () => {
    if (!isOnline) navigate('/go-online/mode')
    else setShowOfflineConfirm(true)
  }

  const handleGoOffline = async () => {
    if (locationIntervalRef.current) { clearInterval(locationIntervalRef.current); locationIntervalRef.current = null }
    disconnectDriverSocket()
    setOffline()
    await driverRideApi.goOffline('driver_choice').catch(() => {})
  }

  // ── Measure content height + compute snap points ─────────────────────────────
  // Observes the inner content div (no height constraint) to get the natural
  // rendered height regardless of how the outer sheet is clipped.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const naturalH = Math.round(el.getBoundingClientRect().height)
      const anchorEl = collapseRef.current
      const sheetEl  = sheetRef.current
      if (anchorEl && sheetEl) {
        // Distance from the sheet's top edge to the sentinel (top of Row 3).
        // This is the collapsed height — shows handle + greeting + stats only.
        const sheetTop  = sheetEl.getBoundingClientRect().top
        const anchorTop = anchorEl.getBoundingClientRect().top
        const collapsed = Math.round(anchorTop - sheetTop) + 20 // +20 breathing room
        setCollapsedH(Math.max(collapsed, 160))
      }
      setMaxContentH(naturalH)
      // First measurement: sheetH starts at 600; snap it to actual content height.
      if (sheetH.get() > naturalH) {
        sheetH.set(naturalH)
        setOcclusion(naturalH + NAV_HEIGHT)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  // sheetH is a stable motion value object — safe to list as dep.
  }, [sheetH])

  // ── Reverse-geocode ──────────────────────────────────────────────────────────
  useEffect(() => {
    const [lat, lng] = mapCenter
    const prev = lastGeoCoord.current
    if (prev && Math.abs(prev[0] - lat) < 3e-4 && Math.abs(prev[1] - lng) < 3e-4) return
    if (geoTimer.current) clearTimeout(geoTimer.current)
    const controller = new AbortController()
    setGeoLoading(true)
    geoTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get<{ address: string }>('/api/v1/geo/reverse', {
          params: { lat, lng },
          signal: controller.signal,
        })
        if (data?.address) {
          setAreaName(data.address)
          lastGeoCoord.current = [lat, lng]
        }
      } catch {
        // keep previous areaName — swallows abort + network errors
      } finally {
        setGeoLoading(false)
      }
    }, 800)
    return () => {
      if (geoTimer.current) clearTimeout(geoTimer.current)
      controller.abort()
    }
  }, [mapCenter])

  // ── Drag gesture handlers ────────────────────────────────────────────────────
  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    // Cancel any in-flight snap animation before taking manual control.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    animRef.current?.stop()
    dragRef.current = { startY: e.clientY, startH: sheetH.get() }
    handlePressed.set(1)
  }

  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    // Dragging up (negative clientY delta) increases sheet height.
    const delta = dragRef.current.startY - e.clientY
    const next  = Math.max(snaps.collapsed, Math.min(snaps.peek, dragRef.current.startH + delta))
    sheetH.set(next)
  }

  function endDrag() {
    if (!dragRef.current) return
    dragRef.current = null
    handlePressed.set(0)
    snapToNearest()
  }

  function snapToNearest() {
    const current  = sheetH.get()
    // getVelocity() returns px/s; positive = increasing height (dragged up).
    const velocity = sheetH.getVelocity()

    let target: number
    if (velocity > 180) {
      target = snaps.peek       // fast flick up → fully open
    } else if (velocity < -180) {
      target = snaps.collapsed  // fast flick down → collapse
    } else {
      // Slow release — snap to whichever snap point is nearer.
      const dCollapsed = Math.abs(current - snaps.collapsed)
      const dPeek      = Math.abs(current - snaps.peek)
      target = dCollapsed < dPeek ? snaps.collapsed : snaps.peek
    }

    const springOpts = prefersReducedMotion
      ? { duration: 0 }
      : { type: 'spring' as const, stiffness: 380, damping: 38, mass: 1 }

    animRef.current = animate(sheetH, target, springOpts)
    // After spring settles, write the exact final occlusion to prevent drift.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    void animRef.current.then(() => { setOcclusion(target + NAV_HEIGHT) })
  }

  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-surface-2">

      {/* Map — full bleed behind everything */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface-2 animate-pulse" />}>
          <DriverMapView center={mapCenter} zoom={15} dimmed={!isOnline}>
            <RecenterMap
              center={mapCenter}
              bottomPadding={occlusion}
              topPadding={110}
            />
            <SelfCarMarker position={mapCenter} areaName={areaName} loading={geoLoading} />
          </DriverMapView>
        </Suspense>
      </div>

      {/* Floating header — sits above the map, never moves with the sheet */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-12 pb-2"
        style={{ zIndex: 10 }}
      >
        <div className="px-3.5 py-2 rounded-2xl" style={GLASS}>
          <span className="font-display font-black text-[17px] tracking-tight leading-none select-none">
            <span className="text-primary">O</span>
            <span className="text-text-primary">car</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Live status pill */}
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={isOnline ? { ...GLASS, border: '1px solid rgba(249,115,22,0.28)' } : GLASS}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-accent-orange animate-pulse-soft' : 'bg-text-muted'}`} />
            <span className={`text-[11px] font-bold ${isOnline ? 'text-amber-700' : 'text-text-muted'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <button
            aria-label="Notifications"
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={GLASS}
          >
            <Bell size={17} className="text-text-secondary" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* ── Bottom sheet — draggable snap sheet ──────────────────────────────── */}
      <motion.div
        ref={sheetRef}
        className="absolute left-0 right-0 rounded-t-[28px] overflow-hidden"
        style={{
          bottom:     NAV_HEIGHT,
          height:     sheetH,
          zIndex:     10,
          background: '#FFFFFF',
          borderTop:  '1px solid rgba(79,70,229,0.08)',
          boxShadow:  '0 -8px 40px rgba(79,70,229,0.12)',
        }}
        initial={prefersReducedMotion ? false : { y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Inner content wrapper — no height constraint so ResizeObserver
            always sees the full natural height even when the sheet is clipped. */}
        <div ref={contentRef}>

          {/* ── Drag handle zone — 44px touch target, full width ── */}
          <div
            className="flex justify-center items-center pt-3 pb-2 cursor-grab active:cursor-grabbing select-none"
            style={{ minHeight: 44, touchAction: 'none' }}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <motion.div
              className="rounded-full"
              style={{
                width:           36,
                height:          3,
                scaleX:          handleScaleX,
                background:      handleBg,
                transformOrigin: 'center',
              }}
            />
          </div>

          <div className="px-5 pt-4 pb-5">

            {/* ── Row 1: Greeting + Toggle ── */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-text-muted text-xs mb-0.5">{todayLabel}</p>
                <p className="text-text-primary font-display font-bold text-[22px] leading-tight">
                  Hi, {firstName} 👋
                </p>
                <p className="text-text-muted text-xs mt-0.5">
                  {isOnline ? 'You\'re live — ride requests incoming' : 'Go online to start earning'}
                </p>
              </div>
              <OnlineToggle isOnline={isOnline} onToggle={handleToggle} />
            </div>

            {/* ── Row 2: Today's stats ── */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {/* Earnings — orange accent (operational income signal) */}
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="rounded-2xl px-3 py-3 text-center" style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.14)' }}>
                  <div className="flex items-center justify-center gap-0.5 mb-0.5">
                    <IndianRupee size={12} className="text-accent-orange" />
                    <span className="font-black text-[15px] tabular-nums text-accent-orange">
                      {e.total_earnings.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <p className="text-text-muted text-[10px] font-semibold">Earned</p>
                </div>
              </motion.div>
              {/* Trips — neutral */}
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: 0.10, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="rounded-2xl px-3 py-3 text-center bg-surface-2 border border-border">
                  <div className="flex items-center justify-center gap-0.5 mb-0.5">
                    <Clock size={11} className="text-text-secondary" />
                    <span className="font-black text-[15px] tabular-nums text-text-primary">{e.trip_count}</span>
                  </div>
                  <p className="text-text-muted text-[10px] font-semibold">Trips</p>
                </div>
              </motion.div>
              {/* Rating — neutral */}
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="rounded-2xl px-3 py-3 text-center bg-surface-2 border border-border">
                  <div className="flex items-center justify-center gap-0.5 mb-0.5">
                    <Star size={11} className="text-text-secondary" />
                    <span className="font-black text-[15px] tabular-nums text-text-primary">{e.rating ?? driver?.rating ?? '—'}</span>
                  </div>
                  <p className="text-text-muted text-[10px] font-semibold">Rating</p>
                </div>
              </motion.div>
            </div>

            {/* ── Collapse anchor — sheet snaps to this point when minimised.
                 Placed after stats, before quick-actions: dragging down hides
                 quick-actions + status banner and reveals more of the map. ── */}
            <div ref={collapseRef} />

            {/* ── Row 3: Quick actions ── */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={() => navigate('/earnings')}
                className="flex items-center justify-between px-4 py-3 rounded-2xl active:opacity-70 transition-opacity"
                style={{ background: '#F8FAFF', border: '1px solid #E2E8F0' }}
              >
                <div className="flex items-center gap-2">
                  <TrendingUp size={15} className="text-primary" />
                  <span className="text-text-primary text-[13px] font-semibold">Earnings</span>
                </div>
                <ChevronRight size={14} className="text-text-muted" />
              </button>
              <button
                onClick={() => navigate('/wallet')}
                className="flex items-center justify-between px-4 py-3 rounded-2xl active:opacity-70 transition-opacity"
                style={{ background: '#F8FAFF', border: '1px solid #E2E8F0' }}
              >
                <div className="flex items-center gap-2">
                  <Wallet size={15} className="text-primary" />
                  <span className="text-text-primary text-[13px] font-semibold">Wallet</span>
                </div>
                <ChevronRight size={14} className="text-text-muted" />
              </button>
            </div>

            {/* ── Row 4: Live status banner ── */}
            {isOnline ? (
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.16)' }}>
                <span className="w-2 h-2 rounded-full bg-accent-orange animate-pulse-soft flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-amber-700 text-[13px] font-bold leading-tight">Searching for nearby rides…</p>
                  <p className="text-amber-600/70 text-[11px] mt-0.5">Stay in the area for faster matching</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: '#F8FAFF', border: '1px solid #E2E8F0' }}>
                <span className="w-2 h-2 rounded-full bg-text-muted flex-shrink-0" />
                <p className="text-text-muted text-[13px]">Tap the toggle above to go online</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Go offline confirmation — fixed so it covers BottomNav (z-110) */}
      {showOfflineConfirm && (
        <div
          className="fixed inset-0 flex items-end justify-center px-5"
          style={{ zIndex: 110, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
          onClick={() => setShowOfflineConfirm(false)}
        >
          <div
            className="w-full rounded-3xl p-6"
            style={{ background: '#FFFFFF', boxShadow: '0 -4px 32px rgba(79,70,229,0.14)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-8 h-1 bg-border rounded-full mx-auto mb-5" />
            <p className="text-text-primary font-bold text-lg mb-1">Go offline?</p>
            <p className="text-text-muted text-sm mb-6">You'll stop receiving ride requests until you go online again.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowOfflineConfirm(false)}
                className="flex-1 py-3 rounded-2xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowOfflineConfirm(false); void handleGoOffline() }}
                className="flex-1 py-3 rounded-2xl text-sm font-bold text-white transition-colors"
                style={{ background: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)' }}
              >
                Go Offline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
