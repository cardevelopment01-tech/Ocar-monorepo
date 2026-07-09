import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Car, AlertCircle, Check, Zap } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { motion, AnimatePresence } from 'framer-motion'
import { driverRideApi } from '@/lib/ride-api'
import { connectDriverSocket } from '@/lib/socket'
import { useSessionStore } from '@/store/useSessionStore'

const CHECKLIST = [
  'Vehicle is clean and ready',
  'AC is working properly',
  'Phone is charged',
  'Documents are up to date',
]

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245
const EASE = [0.22, 1, 0.36, 1] as const

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8000,
    })
  )
}

export default function StandardConfirm() {
  const navigate = useNavigate()
  const { setOnline } = useSessionStore()

  const [vehicle, setVehicle] = useState<{ id: number; category_id: number; number_plate: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [goingOnline, setGoingOnline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationWarning, setLocationWarning] = useState(false)
  const [checked, setChecked] = useState<Record<string, boolean>>(
    () => Object.fromEntries(CHECKLIST.map(item => [item, true]))
  )

  useEffect(() => {
    driverRideApi.getMyVehicle()
      .then(v => setVehicle(v))
      .catch(() => setError('Could not load vehicle info'))
      .finally(() => setLoading(false))
  }, [])

  const toggleItem = (item: string) =>
    setChecked(prev => ({ ...prev, [item]: !prev[item] }))

  const handleGoOnline = async () => {
    if (!vehicle) { setError('No active vehicle found. Add one in your profile.'); return }
    setGoingOnline(true)
    setError(null)

    let lat = DEFAULT_LAT
    let lng = DEFAULT_LNG

    try {
      const pos = await getCurrentPosition()
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch {
      setLocationWarning(true)
    }

    try {
      const session = await driverRideApi.goOnline({
        mode:       'standard',
        vehicleId:  vehicle.id,
        categoryId: vehicle.category_id,
        lat,
        lng,
      })
      setOnline(Number(session.id), vehicle.id, vehicle.category_id)
      connectDriverSocket()
      navigate('/')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      setError(msg ?? 'Failed to go online. Please try again.')
    } finally {
      setGoingOnline(false)
    }
  }

  return (
    <div className="h-[100dvh] bg-bg text-text-primary flex flex-col">
      {/* Scrollable content: min-h-0 is required so flex child can shrink below its natural size */}
      <div
        className="flex-1 overflow-y-auto min-h-0 px-5 pt-14 pb-4"
        style={{ overscrollBehaviorY: 'contain' }}
      >

        {/* Header */}
        <motion.div
          className="flex items-center gap-3 mb-7"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          <button
            onClick={() => navigate(-1)}
            className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0"
          >
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div>
            <h1 className="font-display text-[22px] font-bold text-text-primary leading-tight">
              You're almost online!
            </h1>
          </div>
        </motion.div>

        {/* ── Hero vehicle card: dark slate ── */}
        <motion.div
          className="rounded-[22px] overflow-hidden mb-3"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.05 }}
          style={{ background: '#0F172A', boxShadow: '0 10px 30px rgba(15,23,42,0.18)' }}
        >
          <div className="p-5">
            <div className="flex items-center gap-4">
              {/* Icon tile */}
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(255,255,255,0.07)' }}
              >
                <Car size={26} className="text-white" strokeWidth={1.8} />
              </div>

              <div className="flex-1 min-w-0">
                {loading ? (
                  <div className="space-y-2">
                    <div className="h-6 w-36 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.12)' }} />
                    <div className="h-4 w-20 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.07)' }} />
                  </div>
                ) : vehicle ? (
                  <>
                    {/* Number plate with frame */}
                    <div
                      className="inline-flex items-center rounded-lg px-3 py-1.5 mb-2"
                      style={{ border: '1.5px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.05)' }}
                    >
                      <span className="font-display text-[22px] font-black text-white tracking-[0.18em]">
                        {vehicle.number_plate}
                      </span>
                    </div>
                    {/* Meta row */}
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.65)' }}
                      >
                        Category {vehicle.category_id}
                      </span>
                      <span className="w-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.25)' }} />
                      <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        Standard Mode
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    No vehicle registered
                  </p>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Pre-ride checklist ── */}
        <motion.div
          className="driver-card mb-3"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.10 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-[#0F172A]" strokeWidth={2} />
            <p className="text-text-primary text-sm font-bold">Pre-ride Checklist</p>
            <span className="ml-auto text-[10px] font-semibold text-text-muted">Tap to toggle</span>
          </div>
          <div className="space-y-1">
            {CHECKLIST.map((item, i) => {
              const isChecked = checked[item] ?? true
              return (
                <motion.button
                  key={item}
                  onClick={() => toggleItem(item)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors"
                  style={{ background: isChecked ? 'rgba(15,23,42,0.03)' : 'rgba(100,116,139,0.04)' }}
                  whileTap={{ scale: 0.98 }}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.05, duration: 0.28, ease: EASE }}
                >
                  {/* Slate checkbox */}
                  <motion.div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2"
                    animate={isChecked
                      ? { backgroundColor: '#0F172A', borderColor: '#0F172A' }
                      : { backgroundColor: 'transparent', borderColor: '#CBD5E1' }
                    }
                    transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                  >
                    <AnimatePresence>
                      {isChecked && (
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                        >
                          <Check size={11} className="text-white" strokeWidth={3} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>

                  <span className={`text-sm font-medium transition-colors ${
                    isChecked ? 'text-text-primary' : 'text-text-muted line-through'
                  }`}>
                    {item}
                  </span>
                </motion.button>
              )
            })}
          </div>
        </motion.div>

        {/* ── GPS warning: neutral ── */}
        <AnimatePresence>
          {locationWarning && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="flex items-start gap-3 rounded-2xl px-4 py-3 mb-3 overflow-hidden bg-surface-2 border border-border"
            >
              <AlertCircle size={15} className="text-text-muted flex-shrink-0 mt-0.5" />
              <p className="text-text-secondary text-sm">GPS unavailable, using your default location</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Error: restrained ── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="flex items-start gap-3 rounded-2xl px-4 py-3 mb-3 overflow-hidden bg-surface-2 border border-border"
            >
              <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-text-primary text-sm">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* ── CTA: always visible at bottom via flex layout ── */}
      <div
        className="relative px-5 bg-bg/95 border-t border-border"
        style={{
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
          paddingTop: 16,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {/* Scroll-affordance fade: softens content edge above the CTA */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: -32,
            height: 32,
            background: 'linear-gradient(to top, #F5F8FF 0%, rgba(245,248,255,0) 100%)',
            pointerEvents: 'none',
          }}
        />
        <button
          onClick={handleGoOnline}
          disabled={goingOnline || loading || !vehicle}
          style={{
            background: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
            boxShadow: '0 4px 20px rgba(15,23,42,0.30)',
            minHeight: 56,
            borderRadius: 24,
          }}
          className="w-full flex items-center justify-center gap-2.5 text-white font-bold text-base cursor-pointer active:scale-[0.98] transition-transform duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {goingOnline ? (
            <>
              <OcarSpinner size={20} variant="white" />
              Going online…
            </>
          ) : (
            <>
              <Zap size={18} strokeWidth={2.2} />
              Go Online Now
            </>
          )}
        </button>
      </div>
    </div>
  )
}
