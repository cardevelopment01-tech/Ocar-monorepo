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
  // cash | online | wallet, shown next to the fare
  paymentChannel?: string
  // estimated trip length in km from the fare quote; for a round trip this is the one-way distance
  tripKm?: number
  // estimated trip time in minutes from the fare quote
  tripMin?: number
  // a rental's included distance (its package km limit)
  kmLimit?: number
}

export type PendingRideRequest = RideRequestPayload & {
  // Local device clock at the moment this request was received -- the countdown
  // is computed from this + timeoutSeconds, never from expiresAt vs Date.now()
  // directly, so device clock skew relative to the server cancels out (Eng
  // review HIGH-severity finding).
  receivedAtMs: number
}
