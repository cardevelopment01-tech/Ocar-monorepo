import api from './api'
import type { PaymentChannel } from './payment-channel'

export type StopInput = { address: string; lat: number; lng: number }

export type RideStop = {
  id: string
  sequence: number
  lat: number
  lng: number
  address: string | null
  status: 'pending' | 'reached' | 'skipped'
  arrived_at: string | null
  reached_at: string | null
  stop_charge_applied: string
  wait_charge: string
}

export type FareEstimate = {
  rate_card_id: number
  surge_event_id: number | null
  surge_multiplier: number
  breakdown: {
    base_fare: number
    distance_fare: number
    time_fare: number
    stop_fare: number
    hour_surcharge: number
    overage_fare: number
    surge_fare: number
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

export type RideDetail = {
  id: string
  status: string
  ride_type: string
  trip_hours: number | null
  return_at: string | null
  scheduled_for: string | null
  user_id: string
  driver_id: string | null
  origin_address: string | null
  destination_address: string | null
  origin_lat: number
  origin_lng: number
  dest_lat: number | null
  dest_lng: number | null
  driver_name: string | null
  driver_phone: string | null
  driver_rating: string | null
  driver_photo: string | null
  vehicle_number_plate: string | null
  vehicle_color: string | null
  vehicle_name: string | null
  vehicle_model: string | null
  vehicle_brand: string | null
  total_estimated: string | null
  total_final: string | null
  base_fare: string | null
  distance_fare: string | null
  time_fare: string | null
  stop_fare: string | null
  hour_surcharge: string | null
  overage_fare: string | null
  surge_fare: string | null
  surge_multiplier: string | null
  actual_km: string | null
  actual_min: string | null
  cancellation_reason: string | null
  cancellation_reason_code: string | null
  user_rating_given: number | null
  requested_at: string
  accepted_at: string | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  review_flagged_at: string | null
  review_reason: string | null
  startOtp: string | undefined
  endOtp: string | undefined
  driver_current_lat: number | null
  driver_current_lng: number | null
  payment_channel: 'cash' | 'online' | 'wallet'
  payment_status: string | null
  stops: RideStop[]
}

export type RideHistoryItem = {
  id: string
  status: string
  ride_type: string
  origin_address: string | null
  destination_address: string | null
  requested_at: string
  completed_at: string | null
  driver_name: string | null
  fare: string | null
}

export type RideHistoryResponse = {
  rides: RideHistoryItem[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export type UpcomingRide = {
  id: string
  ride_type: string
  origin_address: string | null
  destination_address: string | null
  scheduled_for: string
  fare: string | null
}

export type RentalPackage = {
  id: number
  category_id: number
  category_name: string
  duration_minutes: number
  km_limit: number
  package_fare: number
  extra_per_km: number
  extra_per_min: number
  is_active: boolean
}

export type RetryPaymentResult =
  | { channel: 'online'; order: { orderId: string; key: string; amount: number } | null }
  | { channel: 'wallet'; paid: boolean }

export const rideApi = {
  getEstimate: async (params: {
    categoryId: number
    rideType: 'one_way' | 'round_trip' | 'rental'
    isReturnCab?: boolean
    distanceKm: number
    durationMin: number
    stopCount?: number
    tripHours?: number
    rentalPackageId?: number
    originCityId?: number
  }): Promise<FareEstimate> => {
    // stopCount is round-trip only — rental stops are a free itinerary, callers should pass 0/undefined
    const body: Record<string, unknown> = {
      category_id:   params.categoryId,
      ride_type:     params.rideType,
      is_return_cab: params.isReturnCab ?? false,
      distance_km:   params.distanceKm,
      duration_min:  params.durationMin,
      stop_count:    params.stopCount ?? 0,
      trip_hours:    params.tripHours ?? 0,
      city_id:       params.originCityId,
    }
    if (params.rentalPackageId !== undefined) body['rental_package_id'] = params.rentalPackageId
    const res = await api.post('/api/v1/pricing/estimate', body)
    return res.data as FareEstimate
  },

  createBooking: async (params: {
    categoryId: number
    rideType: 'one_way' | 'round_trip' | 'rental'
    isReturnCab?: boolean
    originLat: number
    originLng: number
    originAddress: string
    destinationLat?: number
    destinationLng?: number
    destinationAddress?: string
    distanceKm: number
    durationMin: number
    tripHours?: number
    rentalPackageId?: number
    originCityId?: number
    destinationCityId?: number
    returnAt?: string
    scheduledFor?: string
    stops?: StopInput[]
    paymentChannel?: PaymentChannel
    riderName?: string
    riderPhone?: string
  }): Promise<BookingResult> => {
    const body: Record<string, unknown> = {
      categoryId:    params.categoryId,
      rideType:      params.rideType,
      isReturnCab:   params.isReturnCab ?? false,
      originLat:     params.originLat,
      originLng:     params.originLng,
      originAddress: params.originAddress,
      distanceKm:    params.distanceKm,
      durationMin:   params.durationMin,
    }
    if (params.destinationLat      !== undefined) body['destinationLat']      = params.destinationLat
    if (params.destinationLng      !== undefined) body['destinationLng']      = params.destinationLng
    if (params.destinationAddress  !== undefined) body['destinationAddress']  = params.destinationAddress
    if (params.tripHours           !== undefined) body['tripHours']           = params.tripHours
    if (params.stops               !== undefined) body['stops']               = params.stops
    if (params.rentalPackageId     !== undefined) body['rentalPackageId']     = params.rentalPackageId
    if (params.originCityId        !== undefined) body['originCityId']        = params.originCityId
    if (params.destinationCityId   !== undefined) body['destinationCityId']   = params.destinationCityId
    if (params.returnAt            !== undefined) body['returnAt']            = params.returnAt
    if (params.scheduledFor        !== undefined) body['scheduledFor']        = params.scheduledFor
    if (params.paymentChannel      !== undefined) body['paymentChannel']      = params.paymentChannel
    if (params.riderName           !== undefined) body['riderName']           = params.riderName
    if (params.riderPhone          !== undefined) body['riderPhone']          = params.riderPhone
    const res = await api.post('/api/v1/rides', body)
    return res.data as BookingResult
  },

  getActiveRide: async (): Promise<{ rideId: string } | null> => {
    try {
      const res = await api.get('/api/v1/rides/me/active-user')
      return res.data as { rideId: string }
    } catch {
      return null
    }
  },

  getRide: async (rideId: string): Promise<RideDetail> => {
    const res = await api.get(`/api/v1/rides/${rideId}`)
    return res.data as RideDetail
  },

  getHistory: async (page = 1, limit = 20): Promise<RideHistoryResponse> => {
    const res = await api.get('/api/v1/rides/me/history', { params: { page, limit } })
    return res.data as RideHistoryResponse
  },

  getUpcoming: async (): Promise<UpcomingRide[]> => {
    const res = await api.get('/api/v1/rides/me/upcoming')
    return (res.data as { rides: UpcomingRide[] }).rides
  },

  getNearbyDrivers: async (lat: number, lng: number): Promise<Array<{ driver_id: string; lat: number; lng: number; category_id: number }>> => {
    const res = await api.get('/api/v1/rides/nearby-drivers', { params: { lat, lng } })
    return (res.data as { drivers: Array<{ driver_id: string; lat: number; lng: number; category_id: number }> }).drivers ?? []
  },

  getReturnCabAvailable: async (params: {
    pickupLat: number
    pickupLng: number
    dropLat: number
    dropLng: number
    categoryId: number
  }): Promise<{ count: number }> => {
    const res = await api.get('/api/v1/rides/return-cab-available', { params: {
      pickupLat:  params.pickupLat,
      pickupLng:  params.pickupLng,
      dropLat:    params.dropLat,
      dropLng:    params.dropLng,
      categoryId: params.categoryId,
    }})
    return res.data as { count: number }
  },

  getRentalPackages: async (categoryId: number): Promise<RentalPackage[]> => {
    const res = await api.get(`/api/v1/pricing/rental-packages/${categoryId}`)
    return res.data as RentalPackage[]
  },

  cancelRide: async (rideId: string, reasonCode?: string, reason?: string): Promise<void> => {
    const body: Record<string, string> = {}
    if (reasonCode !== undefined) body['reasonCode'] = reasonCode
    if (reason     !== undefined) body['reason']     = reason
    await api.post(`/api/v1/rides/${rideId}/cancel`, body)
  },

  verifyPayment: async (
    rideId: string,
    input: { orderId: string; paymentId: string; signature: string },
  ): Promise<void> => {
    await api.post(`/api/v1/rides/${rideId}/payment/verify`, input)
  },

  retryPayment: async (rideId: string): Promise<RetryPaymentResult> => {
    const res = await api.post(`/api/v1/rides/${rideId}/payment/retry`)
    return res.data as RetryPaymentResult
  },
}
