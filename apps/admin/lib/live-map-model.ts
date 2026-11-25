import type { ActiveDriverSession } from './admin-api'
import { isStale } from './driver-staleness'
import { COLORS } from './colors'

// Where each driver is, in the words ops use on a call. One value per driver, worked out from the session and the live ride.
// 'no_location' wins over everything: a dot that has stopped moving must never look like a healthy one.
export type Stage = 'idle' | 'to_pickup' | 'waiting' | 'on_trip' | 'no_location'

export const STAGE_META: Record<Stage, { label: string; color: string }> = {
  idle:        { label: 'Idle',            color: COLORS.success },
  to_pickup:   { label: 'To pickup',       color: COLORS.info },
  waiting:     { label: 'Waiting at pickup', color: COLORS.warning },
  on_trip:     { label: 'In progress',     color: COLORS.primary },
  no_location: { label: 'No location',     color: COLORS.textMuted },
}

export const STAGES: Stage[] = ['to_pickup', 'waiting', 'on_trip', 'idle', 'no_location']

export function stageOf(d: ActiveDriverSession, nowMs: number): Stage {
  if (isStale(d.location_updated_at, nowMs)) return 'no_location'
  if (d.session_status === 'online') return 'idle'
  if (d.ride_status === 'accepted') return 'to_pickup'
  if (d.ride_status === 'driver_arrived') return 'waiting'
  return 'on_trip' // in_progress, returning, or a session that is on a trip with no ride row yet
}

const squash = (s: string) => s.toLowerCase().replace(/[\s\-+]/g, '')

// One search box for everything ops is asked on a call: a driver's name, phone or code, the number plate, the ride number, the rider.
export function matchesQuery(d: ActiveDriverSession, query: string): boolean {
  const q = squash(query)
  if (!q) return true
  return [d.driver_name, d.driver_phone, d.driver_code, d.number_plate, d.ride_id, d.rider_name]
    .some((v) => v != null && squash(String(v)).includes(q))
}

// Problems first: an on-trip driver with no location, then drivers waiting at a pickup, then everyone else by name.
function rank(d: ActiveDriverSession, stage: Stage): number {
  if (stage === 'no_location') return d.session_status === 'on_trip' ? 0 : 4
  if (stage === 'waiting') return 1
  return stage === 'idle' ? 3 : 2
}

export type StageFilter = Stage | 'all'

export function visibleDrivers(drivers: ActiveDriverSession[], query: string, filter: StageFilter, nowMs: number) {
  return drivers
    .map((d) => ({ d, stage: stageOf(d, nowMs) }))
    .filter(({ d, stage }) => (filter === 'all' || stage === filter) && matchesQuery(d, query))
    .sort((a, b) => rank(a.d, a.stage) - rank(b.d, b.stage) || (a.d.driver_name ?? '').localeCompare(b.d.driver_name ?? ''))
}

export function stageCounts(drivers: ActiveDriverSession[], nowMs: number): Record<Stage, number> {
  const out: Record<Stage, number> = { idle: 0, to_pickup: 0, waiting: 0, on_trip: 0, no_location: 0 }
  for (const d of drivers) out[stageOf(d, nowMs)]++
  return out
}

// City and vehicle filters. An empty list means "everyone"; drivers with no city or vehicle on file only show when that filter is off.
export interface FleetFilter { cities: string[]; categories: string[] }
export const NO_FLEET_FILTER: FleetFilter = { cities: [], categories: [] }

export function filterFleet(drivers: ActiveDriverSession[], f: FleetFilter): ActiveDriverSession[] {
  if (f.cities.length === 0 && f.categories.length === 0) return drivers
  return drivers.filter((d) =>
    (f.cities.length === 0 || (d.city_id != null && f.cities.includes(String(d.city_id)))) &&
    (f.categories.length === 0 || (d.category_id != null && f.categories.includes(String(d.category_id)))))
}

export interface Facet { value: string; label: string; count: number }

// The options the filters offer: only cities and vehicle types that have a driver online right now, biggest first. Counts follow the OTHER
// filter (picking a city shows how many of each vehicle type are in it), so an option never promises drivers it will not show.
export function fleetFacets(drivers: ActiveDriverSession[], f: FleetFilter): { cities: Facet[]; categories: Facet[] } {
  const tally = (list: ActiveDriverSession[], id: (d: ActiveDriverSession) => number | null, name: (d: ActiveDriverSession) => string | null) => {
    const m = new Map<string, Facet>()
    for (const d of list) {
      const v = id(d)
      if (v == null) continue
      const key = String(v)
      const hit = m.get(key)
      if (hit) hit.count++
      else m.set(key, { value: key, label: name(d) ?? `#${key}`, count: 1 })
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }
  return {
    cities: tally(filterFleet(drivers, { ...f, cities: [] }), (d) => d.city_id, (d) => d.city_name),
    categories: tally(filterFleet(drivers, { ...f, categories: [] }), (d) => d.category_id, (d) => d.vehicle_category),
  }
}
