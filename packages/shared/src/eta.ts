// One place decides how an ETA reads, so web and mobile never disagree (or show a bogus "0 min · 0.0 km").
// Time is never below "1 min" (Uber: "Pick-up in 1 min"); short distances read in metres like Rapido's "147 m away".

export type EtaText = { time: string; distance: string }

export function formatEta(etaMin: number, distanceKm: number): EtaText {
  const mins = Math.max(1, Math.round(etaMin))
  const time = mins >= 60 ? `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}` : `${mins} min`

  let distance: string
  const metres = Math.round(distanceKm * 100) * 10
  if (distanceKm < 0.05) distance = '<50 m'
  else if (metres < 1000) distance = `${metres} m`
  else distance = `${distanceKm.toFixed(1)} km`
  return { time, distance }
}

// An ETA is only meaningful on the legs where the driver is actually travelling somewhere the rider
// cares about: to the pickup (accepted) or to the drop (in progress / returning). Once the driver has
// arrived, "0 min" is noise.
export function statusShowsEta(status: string): boolean {
  return status === 'accepted' || status === 'in_progress' || status === 'returning'
}

// Straight-line distance at which a driver counts as "at the pickup". The route ETA can't say this: it is a
// snapshot that refreshes about once a minute and never reads below 1 min, so a driver parked at the door
// kept showing "Arriving in 2 min" until they tapped Arrived. 75 m covers GPS drift and a pickup pin set on
// the far side of a road.
export const AT_PICKUP_M = 75
// Once "here" is showing it only clears past this distance, so a driver skirting the 75 m edge on a parallel road
// doesn't flicker between "Your driver is here" and "Arriving in 6 min".
export const LEFT_PICKUP_M = 120

export function driverAtPickup(status: string, driverToPickupM: number | null | undefined, wasAtPickup = false): boolean {
  return status === 'accepted' && driverToPickupM != null && driverToPickupM <= (wasAtPickup ? LEFT_PICKUP_M : AT_PICKUP_M)
}

// An ETA fetched `elapsedMs` ago, counted down so it ticks between fetches instead of freezing for a minute.
export function ageEta(eta: { etaMin: number; distanceKm: number }, elapsedMs: number): { etaMin: number; distanceKm: number } {
  const elapsedMin = Math.max(0, elapsedMs) / 60_000
  const rateKmPerMin = eta.etaMin > 0 ? eta.distanceKm / eta.etaMin : 0
  return {
    etaMin: Math.max(0, Math.round(eta.etaMin - elapsedMin)),
    distanceKm: Math.max(0, eta.distanceKm - rateKmPerMin * elapsedMin),
  }
}
