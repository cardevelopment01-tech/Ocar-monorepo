import { useCallback, useState } from 'react'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { getCurrentOrLastKnownPosition } from '@ocar/mobile-shared'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { connectSocket } from '@/services/socket'
import { startBackgroundTracking } from '@/services/location/backgroundTask'
import { goOnline as apiGoOnline } from './api'
import type { VehicleInfo } from './types'

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

// getCurrentOrLastKnownPosition (mobile-shared) is already timeout-capped and
// falls back to a cached last-known fix on its own -- this only needs to
// handle the doubly-unlikely case where THAT also has nothing to offer
// (fresh install, permission just granted, no OS location history at all).
// A location this coarse is only ever used as the driver's initial map
// position; the real live position starts flowing from startBackgroundTracking
// moments later, so there's nothing lost by falling back fast.

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

  const goOnlineCore = useCallback(async () => {
    if (!vehicle) return
    setGoingOnline(true)
    setError(null)
    setLocationWarning(false)
    try {
      let lat = DEFAULT_LAT
      let lng = DEFAULT_LNG
      try {
        const position = await getCurrentOrLastKnownPosition()
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

  // Only shows the Play-Store-required disclosure card (and re-requests OS
  // permissions) when location access isn't already granted -- previously this
  // unconditionally reshowed the card and re-ran both permission requests on
  // every single "Go Online" tap, even for a driver who'd already granted
  // background location in an earlier session.
  const start = useCallback(async () => {
    if (!vehicle) { setError('No active vehicle found. Add one in your profile.'); return }
    if (mode === 'return_cab' && !destinationCityId) { setError('Select a destination city first.'); return }
    setError(null)

    const [foreground, background] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ])
    if (foreground.status === 'granted' && background.status === 'granted') {
      void goOnlineCore()
      return
    }
    setShowDisclosure(true)
  }, [vehicle, mode, destinationCityId, goOnlineCore])

  const handleDisclosureDecline = useCallback(() => setShowDisclosure(false), [])

  const handleDisclosureAccept = useCallback(async () => {
    setShowDisclosure(false)
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
    void goOnlineCore()
  }, [goOnlineCore])

  return { goingOnline, showDisclosure, locationWarning, error, start, handleDisclosureAccept, handleDisclosureDecline }
}
