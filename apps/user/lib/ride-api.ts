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

export const rideApi = {
  getEstimate: async (params: {
    categoryId: number
    rideType: 'one_way' | 'round_trip' | 'rental'
    isReturnCab?: boolean
    distanceKm: number
    durationMin: number
    stopCount?: number
    originCityId?: number
  }): Promise<FareEstimate> => {
    const res = await api.post('/api/v1/pricing/estimate', {
      category_id:   params.categoryId,
      ride_type:     params.rideType,
      is_return_cab: params.isReturnCab ?? false,
      distance_km:   params.distanceKm,
      duration_min:  params.durationMin,
      stop_count:    params.stopCount ?? 0,
      trip_hours:    0,
      city_id:       params.originCityId,
    })
    return res.data as FareEstimate
  },

  createBooking: async (params: {
    categoryId: number
    rideType: 'one_way' | 'round_trip' | 'rental'
    isReturnCab?: boolean
    originLat: number
    originLng: number
    originAddress: string
    destinationLat: number
    destinationLng: number
    destinationAddress: string
    distanceKm: number
    durationMin: number
    originCityId?: number
    destinationCityId?: number
  }): Promise<BookingResult> => {
    const res = await api.post('/api/v1/rides', {
      categoryId:          params.categoryId,
      rideType:            params.rideType,
      isReturnCab:         params.isReturnCab ?? false,
      originLat:           params.originLat,
      originLng:           params.originLng,
      originAddress:       params.originAddress,
      destinationLat:      params.destinationLat,
      destinationLng:      params.destinationLng,
      destinationAddress:  params.destinationAddress,
      distanceKm:          params.distanceKm,
      durationMin:         params.durationMin,
      originCityId:        params.originCityId,
      destinationCityId:   params.destinationCityId,
    })
    return res.data as BookingResult
  },

  getRide: async (rideId: string): Promise<RideDetail> => {
    const res = await api.get(`/api/v1/rides/${rideId}`)
    return res.data as RideDetail
  },
}
