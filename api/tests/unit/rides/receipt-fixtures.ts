import type { ReceiptRide, ReceiptStopRow } from '@/modules/rides/receipt/receipt.model'

// Rides shaped like getRideById rows, one per ride shape the receipt has to cope with. Used by the model tests and the PDF smoke test.
const base: ReceiptRide = {
  id: '48213', status: 'completed', ride_type: 'one_way', trip_mode: 'city',
  requested_at: '2026-11-21T09:40:00.000Z', started_at: '2026-11-21T09:52:00.000Z', completed_at: '2026-11-21T10:19:00.000Z',
  origin_address: 'MT-III 13-16, Aerodrome Area, Bhubaneswar, Odisha 751020', destination_address: 'Plot 119, K2, Kalinganagar, Bhubaneswar, Odisha 751029',
  origin_lat: 20.2444, origin_lng: 85.8178, dest_lat: 20.2961, dest_lng: 85.8245,
  payment_channel: 'cash', payment_status: 'completed', cash_collected_at: '2026-11-21T10:19:30.000Z',
  user_name: 'Sujal Ghosh', driver_name: 'Keshab Sahu', driver_rating: '4.95', vehicle_number_plate: 'OD 02 CP 1895', vehicle_brand: 'Maruti', vehicle_model: 'Swift',
  assigned_category_name: 'Hatchback', total_estimated: '217', total_final: '217', base_fare: '60', distance_fare: '117', time_fare: '40', actual_km: '10.7', actual_min: '27',
}
export const CITY_RIDE = base
export const trail = (n = 40): Array<[number, number]> => Array.from({ length: n }, (_, i) => [20.2444 + (i / (n - 1)) * 0.0517 + Math.sin(i / 3) * 0.002, 85.8178 + (i / (n - 1)) * 0.0067 + Math.cos(i / 4) * 0.003])

export const CASH_DUE: ReceiptRide = { ...base, cash_collected_at: null }

export const ONE_WAY_FULL: ReceiptRide = {
  ...base, id: '48214', trip_mode: 'standard', total_final: '890.2', base_fare: '120', distance_fare: '426', time_fare: '110', stop_fare: '30', surge_fare: '137.2', surge_multiplier: '1.2',
  toll_charge: '40', toll_detail: [{ zone: 'Biju Patnaik Airport', amount: 40 }], pickup_wait_min: '5', pickup_free_wait_min: 3, pickup_wait_charge: '15', discount_amount: '100',
  actual_km: '28.4', actual_min: '55', payment_channel: 'online', cash_collected_at: null,
}
export const ONE_WAY_FULL_STOPS: ReceiptStopRow[] = [
  { sequence: 1, address: 'Malipada Chhak, Bhubaneswar, Odisha 752054', arrived_at: '2026-11-21T10:08:00.000Z', reached_at: '2026-11-21T10:12:00.000Z', wait_charge: '12', status: 'reached' },
]

export const RENTAL: ReceiptRide = {
  ...base, id: '48216', ride_type: 'rental', trip_mode: 'standard', total_final: '1487', base_fare: '1100', overage_fare: '218', overage_km: '12', overage_min: '25',
  rental_extra_per_km: '14', rental_extra_per_min: '2', rental_km_limit: '40', rental_duration_minutes: 240, distance_fare: '0', time_fare: '0', stop_fare: '60', toll_charge: '40', toll_detail: [{ zone: 'Biju Patnaik Airport', amount: 40 }],
  pickup_wait_min: '8', pickup_free_wait_min: 3, pickup_wait_charge: '15', actual_km: '52', actual_min: '265', started_at: '2026-11-21T06:40:00.000Z', completed_at: '2026-11-21T11:05:00.000Z',
}
export const RENTAL_STOPS: ReceiptStopRow[] = [
  { sequence: 1, address: 'Bindusagar Road, Old Town, Bhubaneswar 751002', arrived_at: '2026-11-21T07:20:00.000Z', reached_at: '2026-11-21T07:32:00.000Z', wait_charge: '30', status: 'reached' },
  { sequence: 2, address: 'Nandankanan Road, Bhubaneswar 751024', arrived_at: '2026-11-21T09:50:00.000Z', reached_at: '2026-11-21T09:56:00.000Z', wait_charge: '24', status: 'reached' },
]

export const ROUND_HOURLY: ReceiptRide = {
  ...base, id: '48217', ride_type: 'round_trip', trip_mode: 'standard', trip_hours: 10, total_final: '3394', distance_fare: '1704', waiting_fare: '1500', stop_fare: '30',
  actual_km: '142', actual_min: '620', overtimeMin: 20, overtimeFare: '100', overtimeGraceMin: 15, bookedUntil: '2026-11-21T12:00:00.000Z',
  started_at: '2026-11-21T02:00:00.000Z', completed_at: '2026-11-21T12:20:00.000Z', drop_arrived_at: '2026-11-21T04:35:00.000Z', toll_charge: '60', toll_detail: [{ zone: 'Konark Marine Drive', amount: 60 }],
  base_fare: '0', time_fare: '0',
}

export const ROUND_DAILY: ReceiptRide = {
  ...base, id: '48219', ride_type: 'round_trip', trip_mode: 'standard', total_final: '5812', base_fare: '1800', hour_surcharge: '800', distance_fare: '2884', overage_fare: '108', toll_charge: '220',
  actual_km: '412', actual_min: '1950', time_fare: '0',
}

export const CANCELLED_FEE: ReceiptRide = {
  ...base, id: '48220', status: 'cancelled', cancelled_at: '2026-11-21T12:45:00.000Z', cancellation_fee: 50, cancellation_reason: 'Cancelled by you after the driver arrived', cancellation_actor: 'user',
  payment_channel: 'online', payment_status: 'completed', total_final: null, total_estimated: '217',
}
export const CANCELLED_FREE: ReceiptRide = { ...CANCELLED_FEE, id: '48221', cancellation_fee: 0 }

/** Many stops: forces the receipt onto a second page. */
export const MANY_STOPS: ReceiptStopRow[] = Array.from({ length: 12 }, (_, i) => ({
  sequence: i + 1, address: `Stop ${i + 1} Square, Patia, Bhubaneswar, Odisha 7510${10 + i}`,
  arrived_at: `2026-11-21T10:${String(10 + i * 3).padStart(2, '0')}:00.000Z`, reached_at: `2026-11-21T10:${String(12 + i * 3).padStart(2, '0')}:00.000Z`, wait_charge: '6', status: 'reached',
}))
export const MANY_STOPS_RIDE: ReceiptRide = { ...base, id: '48218', trip_mode: 'standard', total_final: '1171', base_fare: '120', distance_fare: '543', time_fare: '196', stop_fare: '240' }
