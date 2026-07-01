import api from './api'

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
  estimatedFare: number
  surgeMultiplier: number
}

export type RideDetail = {
  id: string
  status: string
  ride_type: string
  trip_hours: number | null
  return_at: string | null
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
  total_estimated: string | null
  requested_at: string
  accepted_at: string | null
  started_at: string | null
  completed_at: string | null
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

export type RentalPackage = {
  id: number
  category_id: number
  category_name: string
  duration_hours: number
  km_limit: number
  package_fare: number
  extra_per_km: number
  extra_per_min: number
  is_active: boolean
}

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
    if (params.rentalPackageId     !== undefined) body['rentalPackageId']     = params.rentalPackageId
    if (params.originCityId        !== undefined) body['originCityId']        = params.originCityId
    if (params.destinationCityId   !== undefined) body['destinationCityId']   = params.destinationCityId
    if (params.returnAt            !== undefined) body['returnAt']            = params.returnAt
    const res = await api.post('/api/v1/rides', body)
    return res.data as BookingResult
  },

  getRide: async (rideId: string): Promise<RideDetail> => {
    const res = await api.get(`/api/v1/rides/${rideId}`)
    return res.data as RideDetail
  },

  getHistory: async (page = 1, limit = 20): Promise<RideHistoryResponse> => {
    const res = await api.get('/api/v1/rides/me/history', { params: { page, limit } })
    return res.data as RideHistoryResponse
  },

  getNearbyDrivers: async (lat: number, lng: number): Promise<Array<{ driver_id: string; lat: number; lng: number; category_id: number }>> => {
    const res = await api.get('/api/v1/rides/nearby-drivers', { params: { lat, lng } })
    return (res.data as { drivers: Array<{ driver_id: string; lat: number; lng: number; category_id: number }> }).drivers ?? []
  },

  getRentalPackages: async (categoryId: number): Promise<RentalPackage[]> => {
    const res = await api.get(`/api/v1/pricing/rental-packages/${categoryId}`)
    return res.data as RentalPackage[]
  },

  demoForce: async (rideId: string, action: 'complete' | 'cancel'): Promise<void> => {
    await api.post(`/api/v1/rides/${rideId}/demo-force`, { action })
  },
}
