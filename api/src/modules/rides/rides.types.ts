export interface DriverSession {
  id: bigint
  driver_id: bigint
  vehicle_id: bigint
  category_id: bigint
  category_name: string
  mode: 'standard' | 'return_cab'
  status: 'online' | 'on_trip' | 'offline'
  destination_city_id: bigint | null
  origin_lat: string | null
  origin_lng: string | null
  went_online_at: string
  went_on_trip_at: string | null
  went_offline_at: string | null
  offline_reason: string | null
  trips_completed: number
  earnings_this_session: string
  created_at: string
  updated_at: string
}

export interface NearbyDriver {
  driver_id: bigint
  session_id: bigint
  mode: string
  lat: number
  lng: number
  distance_metres: number
}

export interface Ride {
  id: bigint
  user_id: bigint
  driver_id: bigint | null
  session_id: bigint | null
  vehicle_id: bigint | null
  category_id: bigint
  ride_type: 'one_way' | 'round_trip' | 'rental'
  is_return_cab: boolean
  status: string
  payment_channel: 'cash' | 'online' | 'wallet'
  origin_address: string | null
  destination_address: string | null
  origin_lat: number
  origin_lng: number
  dest_lat: number | null
  dest_lng: number | null
  origin_city_id: bigint | null
  destination_city_id: bigint | null
  trip_hours: number | null
  rental_package_id: bigint | null
  scheduled_for: string | null
  return_at: string | null
  start_otp_hash: string | null
  end_otp_hash: string | null
  requested_at: string
  accepted_at: string | null
  driver_arrived_at: string | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  actual_distance_km: string | null
  actual_duration_min: string | null
  cash_collected_amount: string | null
  cash_collected_at: string | null
  cash_discrepancy: boolean
  cash_collection_note: string | null
  sos_triggered: boolean
  rider_phone: string | null
  rider_name: string | null
  user_phone: string | null
  user_name: string | null
  user_rating: string | null
  driver_name: string | null
  driver_phone: string | null
  driver_rating: string | null
  driver_photo: string | null
  total_estimated: string | null
  vehicle_number_plate: string | null
  vehicle_color: string | null
  vehicle_name: string | null
  vehicle_model: string | null
  vehicle_brand: string | null
  driver_current_lat: number | null
  driver_current_lng: number | null
  payment_status: string | null
}

export interface StopInput {
  address?: string
  lat: number
  lng: number
}

export interface RideStop {
  id: bigint
  ride_id: bigint
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

export interface BookingRequest {
  categoryId: number
  rideType: 'one_way' | 'round_trip' | 'rental'
  isReturnCab?: boolean
  originLat: number
  originLng: number
  originAddress?: string
  destinationLat?: number
  destinationLng?: number
  destinationAddress?: string
  originCityId?: number
  destinationCityId?: number
  distanceKm: number
  durationMin: number
  /** @deprecated derive from `stops.length` — accepted-but-ignored for one release */
  stopCount?: number
  stops?: StopInput[]
  tripHours?: number
  rentalPackageId?: number
  returnAt?: string
  scheduledFor?: string
  paymentChannel?: 'cash' | 'online' | 'wallet'
  /** Booking on behalf of someone else — omitted/undefined means "myself" */
  riderName?: string
  riderPhone?: string
}
