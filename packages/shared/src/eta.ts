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
