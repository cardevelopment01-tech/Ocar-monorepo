import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react'
import { driverRideApi } from '@/lib/ride-api'
import { connectDriverSocket } from '@/lib/socket'
import { useSessionStore } from '@/store/useSessionStore'

const CHECKLIST = [
  'Vehicle is clean and ready',
  'AC working properly',
  'Phone is charged',
  'Documents are up to date',
]

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

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

  useEffect(() => {
    driverRideApi.getMyVehicle()
      .then(v => setVehicle(v))
      .catch(() => setError('Could not load vehicle info'))
      .finally(() => setLoading(false))
  }, [])

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
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-28 flex flex-col">
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <h1 className="text-xl font-bold">Ready to Drive?</h1>
      </div>

      {/* Vehicle info */}
      <div className="bg-surface rounded-3xl border border-border p-5 mb-4">
        <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">Your Vehicle</p>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center text-3xl">
            🚗
          </div>
          <div>
            {loading ? (
              <div className="w-32 h-4 bg-surface-3 rounded animate-pulse" />
            ) : vehicle ? (
              <>
                <p className="text-text-primary font-bold text-lg">{vehicle.number_plate}</p>
                <p className="text-text-muted text-sm">Category ID: {vehicle.category_id}</p>
              </>
            ) : (
              <p className="text-accent-red text-sm">No vehicle registered</p>
            )}
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div className="bg-surface rounded-3xl border border-border p-5 mb-4">
        <p className="text-text-secondary text-sm font-semibold mb-4">Pre-ride Checklist</p>
        {CHECKLIST.map(item => (
          <div key={item} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
            <CheckCircle size={18} className="text-primary flex-shrink-0" />
            <span className="text-text-secondary text-sm">{item}</span>
          </div>
        ))}
      </div>

      {locationWarning && (
        <div className="flex items-start gap-3 bg-accent-amber/10 border border-accent-amber/30 rounded-2xl px-4 py-3 mb-4">
          <AlertCircle size={16} className="text-accent-amber flex-shrink-0 mt-0.5" />
          <p className="text-accent-amber text-sm">Using default location — GPS unavailable</p>
        </div>
      )}

      {error && (
        <p className="text-accent-red text-sm text-center mb-4">{error}</p>
      )}

      {/* Fixed bottom CTA — always visible regardless of content length */}
      <div
        className="fixed bottom-0 left-0 right-0 px-5 bg-bg border-t border-border"
        style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))', paddingTop: 16, zIndex: 10 }}
      >
        <button
          onClick={handleGoOnline}
          disabled={goingOnline || loading || !vehicle}
          className="btn-go w-full"
          style={{ minHeight: 56 }}
        >
          {goingOnline ? 'Going online…' : 'Go Online Now'}
        </button>
      </div>
    </div>
  )
}
