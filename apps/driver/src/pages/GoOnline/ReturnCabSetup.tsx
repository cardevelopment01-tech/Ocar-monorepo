import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CornerUpLeft, ChevronDown, AlertCircle, Zap } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { motion, AnimatePresence } from 'framer-motion'
import { driverRideApi } from '@/lib/ride-api'
import { connectDriverSocket } from '@/lib/socket'
import { useSessionStore } from '@/store/useSessionStore'
import api from '@/lib/api'

const EASE = [0.22, 1, 0.36, 1] as const

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

type City = { id: number; name: string; slug: string }

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8000,
    })
  )
}

export default function ReturnCabSetup() {
  const navigate = useNavigate()
  const { setOnline } = useSessionStore()

  const [cities,          setCities]          = useState<City[]>([])
  const [vehicle,         setVehicle]         = useState<{ id: number; category_id: number } | null>(null)
  const [selectedCityId,  setSelectedCityId]  = useState<number | null>(null)
  const [loadingInit,     setLoadingInit]     = useState(true)
  const [goingOnline,     setGoingOnline]     = useState(false)
  const [locationWarning, setLocationWarning] = useState(false)
  const [error,           setError]           = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<{ cities: City[] }>('/api/v1/geo/cities').then(r => r.data.cities ?? []),
      driverRideApi.getMyVehicle(),
    ])
      .then(([cityList, v]) => {
        setCities(cityList)
        setVehicle(v)
      })
      .catch(() => setError('Could not load data. Please go back and try again.'))
      .finally(() => setLoadingInit(false))
  }, [])

  const selectedCity = cities.find(c => c.id === selectedCityId)

  const handleGoOnline = async () => {
    if (!vehicle)       { setError('No active vehicle found.'); return }
    if (!selectedCityId) { setError('Select a destination city first.'); return }
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
        mode:              'return_cab',
        vehicleId:         vehicle.id,
        categoryId:        vehicle.category_id,
        lat,
        lng,
        destinationCityId: selectedCityId,
      })
      setOnline(Number(session.id), vehicle.id, vehicle.category_id, 'return_cab', selectedCity?.name)
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
              Return Cab Mode
            </h1>
            <p className="text-text-muted text-sm mt-0.5">You'll only get rides heading your way</p>
          </div>
        </motion.div>

        {/* Hero icon */}
        <motion.div
          className="flex justify-center mb-6"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.05 }}
        >
          <div className="w-20 h-20 rounded-[24px] bg-emerald-600 flex items-center justify-center shadow-lg">
            <CornerUpLeft size={34} className="text-white" strokeWidth={1.8} />
          </div>
        </motion.div>

        {/* City selector */}
        <motion.div
          className="driver-card mb-3"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.10 }}
        >
          <p className="text-text-primary text-sm font-bold mb-3">Where are you heading?</p>

          {loadingInit ? (
            <div className="flex items-center justify-center py-6">
              <OcarSpinner size={22} variant="mono" />
            </div>
          ) : (
            <div className="relative">
              <select
                value={selectedCityId ?? ''}
                onChange={e => setSelectedCityId(e.target.value ? Number(e.target.value) : null)}
                className="w-full appearance-none rounded-2xl px-4 py-3.5 text-[14px] font-semibold pr-10 cursor-pointer focus:outline-none"
                style={{
                  background: '#F8FAFF',
                  border: '1.5px solid #E2E8F0',
                  color: selectedCityId ? '#0F172A' : '#94A3B8',
                }}
              >
                <option value="">Select destination city</option>
                {cities.map(city => (
                  <option key={city.id} value={city.id}>{city.name}</option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted"
              />
            </div>
          )}

          {selectedCity && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="text-text-muted text-[12px] mt-2.5 leading-relaxed"
            >
              You'll only receive rides going towards{' '}
              <span className="font-semibold text-text-secondary">{selectedCity.name}</span>.
              Discounted return rates apply.
            </motion.p>
          )}
        </motion.div>

        {/* GPS warning */}
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
              <p className="text-text-secondary text-sm">GPS unavailable — using your default location</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
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

      {/* CTA */}
      <div
        className="relative px-5 bg-bg/95 border-t border-border"
        style={{
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
          paddingTop: 16,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', left: 0, right: 0, top: -32, height: 32,
            background: 'linear-gradient(to top, #F5F8FF 0%, rgba(245,248,255,0) 100%)',
            pointerEvents: 'none',
          }}
        />
        <button
          onClick={handleGoOnline}
          disabled={goingOnline || loadingInit || !vehicle || !selectedCityId}
          style={{ minHeight: 56, borderRadius: 24 }}
          className="w-full flex items-center justify-center gap-2.5 text-white font-bold text-base cursor-pointer active:scale-[0.98] transition-transform duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 bg-gradient-to-br from-emerald-600 to-emerald-700 shadow-lg"
        >
          {goingOnline ? (
            <>
              <OcarSpinner size={20} variant="white" />
              Going online…
            </>
          ) : (
            <>
              <Zap size={18} strokeWidth={2.2} />
              Go Online as Return Cab
            </>
          )}
        </button>
      </div>
    </div>
  )
}
