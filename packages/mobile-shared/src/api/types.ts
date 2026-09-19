export type ApiError = {
  error: string
  code: string
  requestId?: string
}

export type TokenPair = {
  accessToken: string
  refreshToken: string
}

export type StopInput = { address: string; lat: number; lng: number }

export type RideStop = {
  id: string
  sequence: number
  lat: number
  lng: number
  address: string | null
  status: 'pending' | 'reached' | 'skipped'
  arrivedAt: string | null
  reachedAt: string | null
  stopChargeApplied: string
  waitCharge: string
}

export type FareEstimate = {
  rateCardId: number
  surgeEventId: number | null
  surgeMultiplier: number
  breakdown: {
    baseFare: number
    distanceFare: number
    timeFare: number
    stopFare: number
    hourSurcharge: number
    overageFare: number
    overageKm?: number
    surgeFare: number
    total: number
  }
}

export type BookingResult = {
  rideId: string
  status: string
  scheduledFor?: string
  estimatedFare: number
  surgeMultiplier: number
}

export type VehicleCategory = {
  id: number
  slug: string
  displayName: string
  maxPassengers: number
  isActive: boolean
}

export type RentalPackage = {
  id: number
  categoryId: number
  categoryName: string
  durationMinutes: number
  kmLimit: number
  packageFare: number
  extraPerKm: number
  extraPerMin: number
}

export type RideDetail = {
  id: string
  status: string
  rideType: string
  tripHours: number | null
  returnAt: string | null
  scheduledFor: string | null
  userId: string
  driverId: string | null
  riderName: string | null
  riderPhone: string | null
  originAddress: string | null
  destinationAddress: string | null
  originLat: number
  originLng: number
  destLat: number | null
  destLng: number | null
  driverName: string | null
  driverPhone: string | null
  driverRating: string | null
  driverPhoto: string | null
  vehicleNumberPlate: string | null
  vehicleColor: string | null
  vehicleName: string | null
  vehicleModel: string | null
  vehicleBrand: string | null
  bookedCategoryName: string | null
  assignedCategoryName: string | null
  totalEstimated: string | null
  totalFinal: string | null
  baseFare: string | null
  distanceFare: string | null
  timeFare: string | null
  stopFare: string | null
  hourSurcharge: string | null
  overageFare: string | null
  surgeFare: string | null
  startOtp: string | null
  endOtp: string | null
  stops: RideStop[]
}

export type RideHistoryItem = {
  id: string
  status: string
  rideType: string
  originAddress: string | null
  destinationAddress: string | null
  totalFinal: string | null
  totalEstimated: string | null
  createdAt: string
}

export type GeoAutocompleteResult = {
  placeId: string
  description: string
}

export type GeoPlaceDetail = {
  address: string
  lat: number
  lng: number
}

export type SOSTriggerResult = { ok: true } | { ok: false; reason: 'rate_limited' | 'error' }

export type RatingTag = {
  id: string
  tagKey: string
  label: string
  sentiment: 'positive' | 'negative' | 'neutral'
  appliesTo: 'driver' | 'user' | 'both'
  sortOrder: number
}
