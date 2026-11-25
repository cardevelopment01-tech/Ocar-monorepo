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
