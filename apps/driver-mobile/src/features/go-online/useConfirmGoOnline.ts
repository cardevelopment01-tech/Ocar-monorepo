import { useCallback, useState } from 'react'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { connectSocket } from '@/services/socket'
import { startBackgroundTracking } from '@/services/location/backgroundTask'
import { goOnline as apiGoOnline } from './api'
import type { VehicleInfo } from './types'

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

export type ConfirmGoOnlineState = {
  goingOnline: boolean
  showDisclosure: boolean
  locationWarning: boolean
  error: string | null
  start: () => void
  handleDisclosureAccept: () => Promise<void>
  handleDisclosureDecline: () => void
}

// Shared by the Standard and Return Cab confirm screens -- the disclosure/
// permission/API-call/tracking sequence is identical between modes, only the
// goOnline() payload (destinationCityId) and the post-online session fields differ.
export function useConfirmGoOnline(
  vehicle: VehicleInfo | null,
  mode: 'standard' | 'return_cab',
  destinationCityId: number | null,
  destinationCityName: string | undefined
): ConfirmGoOnlineState {
  const router = useRouter()
  const setOnline = useDriverSessionStore((s) => s.setOnline)

  const [goingOnline, setGoingOnline] = useState(false)
  const [showDisclosure, setShowDisclosure] = useState(false)
  const [locationWarning, setLocationWarning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(() => {
    if (!vehicle) { setError('No active vehicle found. Add one in your profile.'); return }
    if (mode === 'return_cab' && !destinationCityId) { setError('Select a destination city first.'); return }
    setError(null)
    setShowDisclosure(true)
  }, [vehicle, mode, destinationCityId])

  const handleDisclosureDecline = useCallback(() => setShowDisclosure(false), [])

  const handleDisclosureAccept = useCallback(async () => {
    setShowDisclosure(false)
    if (!vehicle) return
    setGoingOnline(true)
    setError(null)
    setLocationWarning(false)
    try {
      const foreground = await Location.requestForegroundPermissionsAsync()
      if (foreground.status !== 'granted') {
        setError('Location permission is required to go online.')
        return
      }
      const background = await Location.requestBackgroundPermissionsAsync()
      if (background.status !== 'granted') {
        setError('Background location is required to receive ride requests while online.')
        return
      }

      let lat = DEFAULT_LAT
      let lng = DEFAULT_LNG
      try {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        lat = position.coords.latitude
        lng = position.coords.longitude
      } catch {
        setLocationWarning(true)
      }

      const input: Parameters<typeof apiGoOnline>[0] = { mode, vehicleId: vehicle.id, categoryId: vehicle.categoryId, lat, lng }
      if (destinationCityId != null) input.destinationCityId = destinationCityId
      const session = await apiGoOnline(input)

      setOnline({
        id: session.id,
        vehicleId: vehicle.id,
        categoryId: vehicle.categoryId,
        mode,
        destinationCityName: mode === 'return_cab' ? (destinationCityName ?? null) : null,
      })
      await startBackgroundTracking()
      connectSocket()
      router.replace('/(tabs)/home')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to go online. Please try again.')
    } finally {
      setGoingOnline(false)
    }
  }, [vehicle, mode, destinationCityId, destinationCityName, setOnline, router])

  return { goingOnline, showDisclosure, locationWarning, error, start, handleDisclosureAccept, handleDisclosureDecline }
}
