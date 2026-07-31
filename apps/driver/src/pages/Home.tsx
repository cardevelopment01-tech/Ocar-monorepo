import { useEffect, useRef, useState, useMemo, lazy, Suspense } from 'react'
import {
  motion, useReducedMotion,
  useMotionValue, useTransform, useMotionValueEvent, animate,
} from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { IndianRupee, Clock, Star, TrendingUp, Wallet, ChevronRight, LocateOff } from 'lucide-react'
import OnlineToggle from '@/components/ui/OnlineToggle'
import StatusBar from '@/components/ui/StatusBar'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useRideStore } from '@/store/useRideStore'
import { driverRideApi, type EarningsSummary } from '@/lib/ride-api'
import { driverVerificationApi } from '@/lib/driver-verification-api'
import api from '@/lib/api'
import { disconnectDriverSocket } from '@/lib/socket'
import { useDriverLocation } from '@/lib/useDriverLocation'

const DriverMapView = lazy(() => import('@/components/map/DriverMapView'))
const RecenterMap   = lazy(() => import('@/components/map/RecenterMap'))
const SelfCarMarker = lazy(() => import('@/components/map/SelfCarMarker'))

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245
const NAV_HEIGHT  = 60

export default function Home() {
  const navigate = useNavigate()
  const driver   = useAuthStore(s => s.driver)
  const { isOnline, sessionId, mode, destinationCityName, setOffline, earningsToday, tripsToday, setEarnings } = useSessionStore()
  const activeRide = useRideStore(s => s.activeRide)
  const prefersReducedMotion = useReducedMotion()

  // ── Refs ────────────────────────────────────────────────────────────────────
  const sheetRef            = useRef<HTMLDivElement | null>(null)
  // contentRef wraps inner content (no height constraint) so ResizeObserver
  // sees the natural rendered height even when the outer sheet is clipped.
  const contentRef          = useRef<HTMLDivElement | null>(null)
  // Sentinel placed after the stats row, defines the collapsed snap point.
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
  // occlusion drives RecenterMap.bottomPadding, updated via RAF throttle.
  const [occlusion,          setOcclusion]         = useState(420)
  const [areaName,           setAreaName]          = useState<string | null>(null)
  const [geoLoading,         setGeoLoading]        = useState(false)
  const [showOfflineConfirm, setShowOfflineConfirm] = useState(false)
  const [checkingVerification, setCheckingVerification] = useState(false)
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
  // The bar widens and deepens to the brand primary on press, subtle but tactile.
  const handleScaleX = useTransform(handlePressed, [0, 1], [1, 1.65])
  const handleBg     = useTransform(
    handlePressed,
    [0, 1],
    ['rgba(10, 159, 176,0.15)', 'rgba(10, 159, 176,0.48)'],
  )
  // Content below the greeting+toggle row fades out over the first 56px of
  // drag-down, well before the sheet's physical height reaches collapsedH —
  // a soft fade instead of a hard clip means a slightly-off measurement or a
  // mid-drag screenshot never shows a stray card edge peeking through
  // (previously a hard overflow-hidden clip with zero margin for error).
  const belowFoldOpacity = useTransform(sheetH, [collapsedH, collapsedH + 56], [0, 1])

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

  // ── GPS tracking via watchPosition ───────────────────────────────────────────
  const { position: gpsPosition, heading: gpsHeading, error: gpsError } = useDriverLocation({
    highAccuracy: isOnline,
    maxAccuracyM: 100,
    onSync: isOnline && sessionId
      ? (lat, lng, heading) => {
          driverRideApi.updateLocation({
            sessionId: sessionId!,
            lat, lng, heading,
            recordedAt: new Date().toISOString(),
          }).catch(() => {})
        }
      : undefined,
  })

  const positionReady = gpsPosition !== null
  const geoError      = gpsError !== null

  useEffect(() => {
    if (gpsPosition) setMapCenter(gpsPosition)
  }, [gpsPosition])

  const handleToggle = () => {
    if (!isOnline) {
      if (checkingVerification) return // already awaiting a status check from a prior tap
      setCheckingVerification(true)
      driverVerificationApi.getStatus()
        .then((status) => {
          navigate(status.complete ? '/go-online/mode' : '/daily-verification')
        })
        .catch(() => navigate('/go-online/mode')) // status check failed — don't block going online on a network hiccup; goOnline() itself still enforces the gate server-side
        .finally(() => setCheckingVerification(false))
    } else if (activeRide) {
      // A driver mid-fare shouldn't be able to exit the online session at all —
      // the toggle was never previously gated on this, so tapping it during an
      // active ride would open the offline-confirm sheet unguarded. Route back
      // into the ride instead, same destination as the resume-trip banner.
      navigate(resumeRoute ?? '/', { replace: true })
    } else {
      setShowOfflineConfirm(true)
    }
  }

  const handleGoOffline = async () => {
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
        // This is the collapsed height, shows handle + greeting + stats only.
        const sheetTop  = sheetEl.getBoundingClientRect().top
        const anchorTop = anchorEl.getBoundingClientRect().top
        // Anchor sits right after the greeting+toggle row (see its placement
        // below) — collapsed shows handle + name + toggle only, everything
        // else (stats/quick-actions/status) shrinks away on drag-down.
        const collapsed = Math.round(anchorTop - sheetTop) + 20 // +20 breathing room
        // Floor is a degenerate-measurement safety net only (handle zone is
        // ~44px) — must stay well under any real row height, or it silently
        // forces the sheet taller than the anchor and exposes the next
        // section's top edge underneath (exactly what a too-high 160 floor
        // did once the greeting row got more compact).
        setCollapsedH(Math.max(collapsed, 96))
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
  // sheetH is a stable motion value object, safe to list as dep.
  }, [sheetH])

  // ── Reverse-geocode ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!positionReady) return  // don't geocode the default Bhubaneswar fallback coords
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
        // keep previous areaName, swallows abort + network errors
      } finally {
        setGeoLoading(false)
      }
    }, 800)
    return () => {
      if (geoTimer.current) clearTimeout(geoTimer.current)
      controller.abort()
    }
  }, [mapCenter, positionReady])

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
      // Slow release, snap to whichever snap point is nearer.
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

  // Fallback for a failed/slow session-restore fetch (App.tsx): if the store
  // still has an active ride but we somehow landed on Home, offer a manual
  // way back in instead of leaving the driver stranded with no active-ride UI.
  // Today's earnings for the header chip. Fetched on every Home mount — Home
  // remounts when the driver returns from a completed ride, so the total is
  // always fresh, and the persisted store value renders instantly meanwhile.
  useEffect(() => {
    void driverRideApi.getEarningsSummary('today')
      .then(s => setEarnings(s.total_earnings, s.trip_count))
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const resumeRoute =
    activeRide?.status === 'accepted'        ? '/ride/navigate'
    : activeRide?.status === 'driver_arrived' ? '/ride/otp'
    : activeRide?.status === 'in_progress'    ? '/ride/in-progress'
    : null

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-surface-2">

      {/* Map, full bleed behind everything */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface-2 animate-pulse" />}>
          <DriverMapView initialCenter={mapCenter} zoom={15} dimmed={!isOnline}>
            <RecenterMap
              center={mapCenter}
              bottomPadding={occlusion}
              topPadding={110}
            />
            {positionReady && <SelfCarMarker position={mapCenter} areaName={areaName} loading={geoLoading} heading={gpsHeading} />}
          </DriverMapView>
        </Suspense>
      </div>

      {/* Floating header — the shared two-skin StatusBar (floating skin) sits
          above the map and never moves with the sheet. Safe-area handling lives
          in the component. */}
      <StatusBar surface="floating" isOnline={isOnline} earningsToday={earningsToday} tripsToday={tripsToday} />

      {/* Resume-trip banner: shown when the store has an active ride but we
          landed on Home anyway (restore-fetch failure fallback). Takes
          priority over the return-cab/GPS banners below since getting back
          into the trip is the more urgent action. */}
      {resumeRoute && (
        <div
          className="absolute left-4 right-4"
          style={{ top: 'max(calc(env(safe-area-inset-top) + 80px), 96px)', zIndex: 10 }}
        >
          <button
            onClick={() => navigate(resumeRoute, { replace: true })}
            className="gloss-sheen w-full flex items-center gap-3 rounded-2xl px-4 py-3 bg-primary active:scale-[0.98] transition-transform"
            style={{ boxShadow: '0 4px 16px rgba(10, 159, 176,0.28)' }}
          >
            <span className="w-2 h-2 rounded-full bg-white flex-shrink-0 animate-pulse-soft" />
            <span className="flex-1 min-w-0 text-left text-white text-[13px] font-bold">
              Trip in progress — tap to resume
            </span>
            <ChevronRight size={16} className="text-white flex-shrink-0" />
          </button>
        </div>
      )}

      {/* Return Cab mode indicator, floats below the header */}
      {!resumeRoute && isOnline && mode === 'return_cab' && (
        <div
          className="absolute left-4 right-4"
          style={{ top: 'max(calc(env(safe-area-inset-top) + 80px), 96px)', zIndex: 10 }}
        >
          <div
            className="flex items-center gap-2.5 rounded-2xl px-4 py-2.5 bg-emerald-50 border border-emerald-200"
            style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 animate-pulse-soft" />
            <span className="text-emerald-800 text-[12px] font-semibold">
              Return Cab Mode{destinationCityName ? `, heading to ${destinationCityName}` : ''}
            </span>
          </div>
        </div>
      )}

      {/* GPS error, floats below the header, above the map */}
      {!resumeRoute && geoError && (
        <div
          className="absolute left-4 right-4"
          style={{ top: 'max(calc(env(safe-area-inset-top) + 80px), 96px)', zIndex: 10 }}
        >
          <div
            className="flex items-center gap-2.5 rounded-2xl px-4 py-2.5"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          >
            <LocateOff size={14} className="text-red-500 flex-shrink-0" />
            <span className="text-red-600 text-[12px] font-semibold">
              {gpsError?.code === 1
                ? 'Location access denied. Allow it in browser settings'
                : gpsError?.code === 2
                ? 'GPS signal unavailable. Check device location settings'
                : 'Location timed out. Ensure GPS is enabled'}
            </span>
          </div>
        </div>
      )}

      {/* ── Bottom sheet: draggable snap sheet ──────────────────────────────── */}
      <motion.div
        ref={sheetRef}
        className="absolute left-0 right-0 rounded-t-[28px] overflow-hidden"
        style={{
          bottom:     NAV_HEIGHT,
          height:     sheetH,
          zIndex:     10,
          background: '#FFFFFF',
          borderTop:  '1px solid rgba(10, 159, 176,0.08)',
          boxShadow:  '0 -8px 40px rgba(10, 159, 176,0.12)',
        }}
        initial={prefersReducedMotion ? false : { y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Inner content wrapper, no height constraint so ResizeObserver
            always sees the full natural height even when the sheet is clipped. */}
        <div ref={contentRef}>

          {/* ── Drag handle zone: 44px touch target, full width ── */}
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
                  Hi, {firstName}
                </p>
                <p className="text-text-muted text-xs mt-0.5">
                  {isOnline ? 'You\'re live, ride requests incoming' : 'Go online to start earning'}
                </p>
              </div>
              <OnlineToggle isOnline={isOnline} onToggle={handleToggle} disabled={checkingVerification} />
            </div>

            {/* ── Collapse anchor: sheet snaps to this point when minimised.
                 Placed right after the greeting+toggle row so the collapsed
                 state shows only driver name + toggle — stats, quick actions,
                 and the status banner all shrink away, revealing more map
                 (see docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 5). ── */}
            <div ref={collapseRef} />

            <motion.div style={{ opacity: belowFoldOpacity }}>

              {/* ── One unified card: stats + quick actions, no nested chip
                   cards — a plain 3-column stat row (dividers, not separate
                   backgrounds) sitting on top of two full-width action rows.
                   Replaces three separately-floating pill blocks that had
                   uneven widths and gaps between them. ── */}
              <div className="card-glossy p-0 overflow-hidden mb-3">
                <div className="grid grid-cols-3 divide-x divide-border">
                  <div className="flex flex-col items-center justify-center gap-0.5 py-3.5">
                    <div className="flex items-center gap-1">
                      <IndianRupee size={12} className="text-accent-orange" />
                      <span className="font-black text-[15px] tabular-nums text-accent-orange">
                        {e.total_earnings.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <p className="text-text-muted text-[10px] font-semibold">Earned</p>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-0.5 py-3.5">
                    <div className="flex items-center gap-1">
                      <Clock size={11} className="text-text-secondary" />
                      <span className="font-black text-[15px] tabular-nums text-text-primary">{e.trip_count}</span>
                    </div>
                    <p className="text-text-muted text-[10px] font-semibold">Trips</p>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-0.5 py-3.5">
                    <div className="flex items-center gap-1">
                      <Star size={11} className="text-text-secondary" />
                      <span className="font-black text-[15px] tabular-nums text-text-primary">{e.rating ?? driver?.rating ?? '—'}</span>
                    </div>
                    <p className="text-text-muted text-[10px] font-semibold">Rating</p>
                  </div>
                </div>

                <button
                  onClick={() => navigate('/earnings')}
                  className="gloss-sheen w-full flex items-center justify-between px-4 py-3 border-t border-border active:bg-surface-2 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <TrendingUp size={15} className="text-primary" />
                    <span className="text-text-primary text-[13px] font-semibold">Earnings</span>
                  </div>
                  <ChevronRight size={14} className="text-text-muted" />
                </button>
                <button
                  onClick={() => navigate('/wallet')}
                  className="gloss-sheen w-full flex items-center justify-between px-4 py-3 border-t border-border active:bg-surface-2 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Wallet size={15} className="text-primary" />
                    <span className="text-text-primary text-[13px] font-semibold">Wallet</span>
                  </div>
                  <ChevronRight size={14} className="text-text-muted" />
                </button>
              </div>

              {/* ── Live status line: plain text row, no card of its own —
                   supplementary info, not another action. ── */}
              <div className="flex items-center gap-2 px-1">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-accent-orange animate-pulse-soft' : 'bg-text-muted'}`} />
                <p className="text-text-muted text-[12px]">
                  {isOnline ? 'Searching for nearby rides — stay in the area for faster matching' : 'Tap the toggle above to go online'}
                </p>
              </div>

            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* Go offline confirmation, fixed so it covers BottomNav (z-110) */}
      {showOfflineConfirm && (
        <div
          className="fixed inset-0 flex items-end justify-center px-5"
          style={{ zIndex: 110, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
          onClick={() => setShowOfflineConfirm(false)}
        >
          <div
            className="w-full rounded-3xl p-6"
            style={{ background: '#FFFFFF', boxShadow: '0 -4px 32px rgba(10, 159, 176,0.14)' }}
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
