import { useTripWindow as useSharedTripWindow } from '@ocar/mobile-shared'
import { serverNow } from '@/services/api'
import type { RideDetailSettled } from './useActiveRide'

/** The driver's booked-window clock: the shared hook on this app's server-corrected clock. */
export function useTripWindow(ride: Pick<RideDetailSettled, 'bookedUntil' | 'overtimeGraceMin' | 'overtimeRate'> | null) {
  return useSharedTripWindow(ride, { now: serverNow, audience: 'driver' })
}
