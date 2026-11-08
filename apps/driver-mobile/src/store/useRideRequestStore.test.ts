import { describe, it, expect, beforeEach } from 'vitest'
import { useRideRequestStore, resetSeenOffers } from './useRideRequestStore'
import type { RideRequestPayload } from '@/features/ride-requests/types'

const offer = (over: Partial<RideRequestPayload> = {}): RideRequestPayload => ({
  rideId: '1', pickup: 'A', drop: 'B', pickupLat: 0, pickupLng: 0, distanceToPickup: 100, estimatedFare: 100,
  rideType: 'one_way', isReturnCab: false, expiresAt: '2026-01-01T00:00:20Z', timeoutSeconds: 20, offerRound: 1, ...over,
})

beforeEach(() => { resetSeenOffers(); useRideRequestStore.setState({ pending: null }) })

describe('ride offer de-duplication', () => {
  it('a re-delivery of the same ride and round does not restart the countdown', () => {
    const { setPending } = useRideRequestStore.getState()
    setPending(offer())
    const first = useRideRequestStore.getState().pending!.receivedAtMs
    setPending(offer())
    expect(useRideRequestStore.getState().pending!.receivedAtMs).toBe(first)
  })

  it('an offer already answered is not shown again when it is re-delivered', () => {
    const { setPending, clearPending } = useRideRequestStore.getState()
    setPending(offer())
    clearPending('1')
    setPending(offer())
    expect(useRideRequestStore.getState().pending).toBeNull()
  })

  it('a new round for the same ride is a new offer and shows', () => {
    const { setPending, clearPending } = useRideRequestStore.getState()
    setPending(offer())
    clearPending('1')
    setPending(offer({ offerRound: 2 }))
    expect(useRideRequestStore.getState().pending?.offerRound).toBe(2)
  })

  it('an offer with no round (older server) always shows', () => {
    const { setPending, clearPending } = useRideRequestStore.getState()
    const { offerRound: _r, ...noRound } = offer()
    setPending(noRound as RideRequestPayload)
    clearPending('1')
    setPending(noRound as RideRequestPayload)
    expect(useRideRequestStore.getState().pending).not.toBeNull()
  })
})
