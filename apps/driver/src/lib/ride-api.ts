import api from './api'

export type DriverSession = {
  id: number
  driver_id: number
  vehicle_id: number
  category_id: number
  mode: 'standard' | 'return_cab'
  status: 'online' | 'on_trip' | 'offline'
  went_online_at: string
}

export type RideDetail = {
  id: string
  status: string
  origin_address: string | null
  destination_address: string | null
  origin_lat: number
  origin_lng: number
  dest_lat: number | null
  dest_lng: number | null
  user_name: string | null
  user_phone: string | null
  total_estimated: string | null
}

export type TripHistoryItem = {
  id: string
  status: string
  ride_type: string
  origin_address: string | null
  destination_address: string | null
  requested_at: string
  started_at: string | null
  completed_at: string | null
  user_name: string | null
  fare: string | null
  driver_earning: string | null
}

export const driverRideApi = {
  goOnline: async (params: {
    mode: 'standard' | 'return_cab'
    vehicleId: number
    categoryId: number
    lat: number
    lng: number
    destinationCityId?: number
  }): Promise<DriverSession> => {
    const body: Record<string, unknown> = {
      mode:       params.mode,
      vehicleId:  params.vehicleId,
      categoryId: params.categoryId,
      lat:        params.lat,
      lng:        params.lng,
    }
    if (params.destinationCityId !== undefined) body['destinationCityId'] = params.destinationCityId
    const res = await api.post('/api/v1/rides/sessions/online', body)
    return res.data as DriverSession
  },

  goOffline: async (reason = 'driver_choice'): Promise<void> => {
    await api.post('/api/v1/rides/sessions/offline', { reason })
  },

  updateLocation: async (params: {
    sessionId: number
    lat: number
    lng: number
    heading?: number
    speed?: number
    recordedAt: string
  }): Promise<void> => {
    const body: Record<string, unknown> = {
      sessionId:  params.sessionId,
      lat:        params.lat,
      lng:        params.lng,
      recordedAt: params.recordedAt,
    }
    if (params.heading !== undefined) body['heading'] = params.heading
    if (params.speed   !== undefined) body['speed']   = params.speed
    await api.post('/api/v1/rides/sessions/location', body)
  },

  getCurrentSession: async (): Promise<DriverSession | null> => {
    const res = await api.get('/api/v1/rides/sessions/current')
    return res.data as DriverSession | null
  },

  acceptRide: async (rideId: string): Promise<{ success: boolean; rideId: string }> => {
    const res = await api.post(`/api/v1/rides/${rideId}/accept`)
    return res.data as { success: boolean; rideId: string }
  },

  markArrived: async (rideId: string): Promise<{ success: boolean; startOtp: string }> => {
    const res = await api.post(`/api/v1/rides/${rideId}/arrived`)
    return res.data as { success: boolean; startOtp: string }
  },

  verifyStartOtp: async (rideId: string, otp: string): Promise<{ success: boolean; endOtp: string }> => {
    const res = await api.post(`/api/v1/rides/${rideId}/start-otp`, { otp })
    return res.data as { success: boolean; endOtp: string }
  },

  verifyEndOtp: async (
    rideId: string,
    otp: string,
    actualDistanceKm?: number,
    actualDurationMin?: number,
  ): Promise<{ success: boolean; rideId: string }> => {
    const body: Record<string, unknown> = { otp }
    if (actualDistanceKm  !== undefined) body['actual_distance_km']  = actualDistanceKm
    if (actualDurationMin !== undefined) body['actual_duration_min'] = actualDurationMin
    const res = await api.post(`/api/v1/rides/${rideId}/end-otp`, body)
    return res.data as { success: boolean; rideId: string }
  },

  getRide: async (rideId: string): Promise<RideDetail> => {
    const res = await api.get(`/api/v1/rides/${rideId}`)
    return res.data as RideDetail
  },

  getMyTrips: async (page = 1, limit = 20): Promise<{
    trips: TripHistoryItem[]
    pagination: { total: number; page: number; limit: number; pages: number }
  }> => {
    const res = await api.get('/api/v1/rides/me/trips', { params: { page, limit } })
    return res.data as { trips: TripHistoryItem[]; pagination: { total: number; page: number; limit: number; pages: number } }
  },

  getMyVehicle: async (): Promise<{ id: number; category_id: number; number_plate: string; status: string } | null> => {
    const res = await api.get('/api/v1/drivers/onboarding/vehicle-info')
    const data = res.data as { vehicle: { id: number; category_id: number; number_plate: string; status: string } | null }
    return data.vehicle
  },
}
