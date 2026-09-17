// Mirrors the ride:request socket payload built in api/src/websocket/socket.server.ts
// (both the live-broadcast path and the reconnect pending-assignment redelivery path).
export type RideRequestPayload = {
  rideId: string
  pickup: string
  drop: string
  pickupLat: number
  pickupLng: number
  distanceToPickup: number
  estimatedFare: number
  rideType: string
  isReturnCab: boolean
  expiresAt: string
  timeoutSeconds: number
  destinationLat?: number
  destinationLng?: number
  returnAt?: string
  tripHours?: number
  stopCount?: number
}

export type PendingRideRequest = RideRequestPayload & {
  // Local device clock at the moment this request was received -- the countdown
  // is computed from this + timeoutSeconds, never from expiresAt vs Date.now()
  // directly, so device clock skew relative to the server cancels out (Eng
  // review HIGH-severity finding).
  receivedAtMs: number
}
