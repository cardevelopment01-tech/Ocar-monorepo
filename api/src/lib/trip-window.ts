import { isHourlyRoundTrip } from '@/lib/fare'
import { ROUND_TRIP_OVERTIME_GRACE_MIN } from '@/constants/limits'

/** Columns a ride row needs for its booked window (see RIDE_SELECT_SQL / getTripWindowInputs). */
export interface TripWindowRow {
  ride_type: string
  status?: string
  started_at: Date | string | null
  trip_hours: number | string | null
  pricing_version?: number | null | undefined
  round_trip_hour_rate?: number | string | null | undefined
  overtime_min?: number | null | undefined
  overtime_fare?: number | string | null | undefined
}

export interface TripWindowFields {
  /** started_at + booked hours; null until the trip starts or when the ride has no hourly window. */
  bookedUntil: string | null
  /** Rupees per hour billed (per minute) as overtime; null without a window. */
  overtimeRate: number | null
  /** Free minutes after bookedUntil before overtime bills; null without a window. */
  overtimeGraceMin: number | null
  /** Settled overtime, only once the ride is completed. */
  overtimeMin: number | null
  overtimeFare: number | null
}

const NONE: TripWindowFields = {
  bookedUntil: null, overtimeRate: null, overtimeGraceMin: null, overtimeMin: null, overtimeFare: null,
}

/**
 * The booked-window facts every client needs, derived once on the server so the driver, rider and
 * admin screens agree. A ride has a window only when it was quoted hourly (isHourlyRoundTrip),
 * so one-way, rental, legacy and over-24h rides get all-null fields and show no clock.
 * The grace comes from the server constant so no client hardcodes the billing rule.
 */
export function tripWindowFields(row: TripWindowRow): TripWindowFields {
  const hours = Number(row.trip_hours ?? 0)
  const rate = row.round_trip_hour_rate != null ? Number(row.round_trip_hour_rate) : null
  if (row.ride_type !== 'round_trip' || !isHourlyRoundTrip({
    pricing_version: row.pricing_version, trip_hours: hours, hour_rate: rate,
  })) return NONE

  const startedMs = row.started_at != null ? new Date(row.started_at).getTime() : NaN
  const settled = row.status === 'completed'
  return {
    bookedUntil: Number.isNaN(startedMs) ? null : new Date(startedMs + hours * 3_600_000).toISOString(),
    overtimeRate: rate,
    overtimeGraceMin: ROUND_TRIP_OVERTIME_GRACE_MIN,
    overtimeMin: settled && row.overtime_min != null ? row.overtime_min : null,
    overtimeFare: settled && row.overtime_fare != null ? Number(row.overtime_fare) : null,
  }
}

/** Ride with its window fields added (spread keeps every existing field untouched). */
export function withTripWindow<T extends object>(ride: T): T & TripWindowFields {
  return { ...ride, ...tripWindowFields(ride as unknown as TripWindowRow) }
}
