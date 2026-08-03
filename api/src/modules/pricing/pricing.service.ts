import * as repo from './pricing.repository'
import { estimateFare } from '@/lib/fare'
import type { FareEstimateRequest, FareEstimateResponse } from './pricing.types'

/**
 * Round trips have a minimum 4-hour window (driver waits at destination).
 * Raw hours from the client are fractional; we ceil to whole hours.
 * One-way and rental rides pass through unchanged.
 */
export function clampTripHours(rideType: string, tripHours: number | undefined): number {
  if (rideType === 'round_trip') return Math.max(4, Math.ceil(tripHours ?? 0))
  return tripHours ?? 0
}

export async function getFareEstimate(
  req: FareEstimateRequest
): Promise<FareEstimateResponse> {
  // These four lookups are independent of each other — run them concurrently
  // instead of paying 4 sequential round trips.
  const [rateCard, chargePerStop, surgeEvent, pkg] = await Promise.all([
    repo.getCurrentRateCard(req.category_id, req.ride_type),
    repo.getStopCharge(req.category_id),
    req.city_id ? repo.getActiveSurge(req.city_id, req.category_id) : Promise.resolve(null),
    req.ride_type === 'rental' && req.rental_package_id
      ? repo.getRentalPackage(req.rental_package_id)
      : Promise.resolve(null),
  ])

  if (!rateCard) {
    throw Object.assign(
      new Error(`No rate card for category ${req.category_id} / ${req.ride_type}`),
      { httpStatus: 422 }
    )
  }

  const surgeMultiplier = surgeEvent ? parseFloat(surgeEvent.multiplier) : 1.0

  let packageFare: number | null = null
  let extraPerKm = 0
  let extraPerMin = 0
  let rentalHours: number | undefined
  if (pkg) {
    packageFare  = parseFloat(pkg.package_fare)
    extraPerKm   = parseFloat(pkg.extra_per_km)
    extraPerMin  = parseFloat(pkg.extra_per_min)
    rentalHours  = Math.round(pkg.duration_minutes / 60)
  }

  const breakdown = estimateFare({
    rate_card: {
      rate_per_km:        parseFloat(rateCard.rate_per_km),
      rate_per_min:       parseFloat(rateCard.rate_per_min),
      min_fare:           parseFloat(rateCard.min_fare),
      return_rate_per_km: rateCard.return_rate_per_km != null
        ? parseFloat(rateCard.return_rate_per_km) : null,
      hour_rate: rateCard.hour_rate != null
        ? parseFloat(rateCard.hour_rate) : null,
      km_per_day: rateCard.km_per_day != null
        ? parseFloat(rateCard.km_per_day) : null,
      driver_allowance_per_day: rateCard.driver_allowance_per_day != null
        ? parseFloat(rateCard.driver_allowance_per_day) : null,
    },
    ride_type:        req.ride_type,
    is_return_cab:    req.is_return_cab ?? false,
    // round_trip: req.distance_km is the one-way leg from the route lookup;
    // calculateFare now expects the total to-and-fro km directly.
    distance_km:      req.ride_type === 'round_trip' ? req.distance_km * 2 : req.distance_km,
    duration_min:     req.duration_min,
    stop_count:       req.stop_count  ?? 0,
    charge_per_stop:  chargePerStop,
    trip_hours:       clampTripHours(req.ride_type, req.trip_hours),
    surge_multiplier: surgeMultiplier,
    package_fare:     packageFare,
    extra_per_km:     extraPerKm,
    extra_per_min:    extraPerMin,
  })

  const response: import('./pricing.types').FareEstimateResponse = {
    rate_card_id:     rateCard.id,
    surge_event_id:   surgeEvent?.id ?? null,
    surge_multiplier: surgeMultiplier,
    breakdown,
  }
  if (rentalHours !== undefined) response.rental_hours = rentalHours
  return response
}

export async function getAllRateCards() {
  return repo.getAllCurrentRateCards()
}

export async function getRateCardHistory() {
  return repo.getRateCardHistory()
}

export async function getRentalPackages(categoryId: number) {
  return repo.getRentalPackagesByCategory(categoryId)
}

export async function createRateCard(data: Parameters<typeof repo.createRateCard>[0]) {
  return repo.createRateCard(data)
}

export async function getAllSurgeEvents() {
  return repo.getAllSurgeEvents()
}

export async function createSurgeEvent(data: Parameters<typeof repo.createSurgeEvent>[0]) {
  return repo.createSurgeEvent(data)
}

export async function cancelSurgeEvent(id: number, adminId: number) {
  const result = await repo.cancelSurgeEvent(id, adminId)
  if (!result) throw Object.assign(new Error('Surge event not found or already ended'), { httpStatus: 404 })
  return result
}
