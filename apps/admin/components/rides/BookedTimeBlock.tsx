import type { AdminRideDetail } from '@/lib/admin-api'

type Props = { ride: Pick<AdminRideDetail,
  'status' | 'started_at' | 'completed_at' | 'review_reason' |
  'trip_hours' | 'overtimeGraceMin' | 'overtimeRate' | 'overtimeMin' | 'overtimeFare'
> }

// 'm' minutes -> "6h 20m" / "45m"; never "0m" for a trip that has started.
export function formatHM(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin))
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h === 0) return `${rem}m`
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

// What the driver's and rider's clocks showed, in one place, so an overtime dispute can be settled without
// asking an engineer: booked vs actual time, the free grace, and the settled overtime. Round trips with an
// hourly window only (the API sends null window fields for every other ride, so nothing renders for them).
export default function BookedTimeBlock({ ride }: Props) {
  if (ride.overtimeGraceMin == null || ride.trip_hours == null) return null

  const settled = ride.status === 'completed'
  const startMs = ride.started_at ? new Date(ride.started_at).getTime() : null
  const endMs = ride.completed_at ? new Date(ride.completed_at).getTime() : null
  const actualMin = startMs != null && endMs != null ? (endMs - startMs) / 60000 : null
  // Settled by the end-code path = a number (0 or more). Null on a completed ride means it was closed another way
  // (admin force-complete, driver end-early), where overtime is not calculated, so "None" would be untrue.
  const overtimeMin = settled ? (ride.overtimeMin ?? null) : null
  const flagged = ride.review_reason != null && /overtime/i.test(ride.review_reason)

  const rows: Array<[string, string]> = [
    ['Booked', formatHM(ride.trip_hours * 60)],
    ['Actual', actualMin != null ? formatHM(actualMin) : 'In progress'],
    ['Free grace', `${ride.overtimeGraceMin}m`],
    ['Overtime', overtimeMin == null ? (settled ? 'Not calculated' : 'Not settled yet') : overtimeMin > 0
      ? `${overtimeMin}m · ${rupees(ride.overtimeFare ?? 0)}`
      : 'None'],
  ]

  return (
    <div className="bg-surface-2 border border-border-light rounded-xl p-3 space-y-1.5" aria-label="Booked time">
      <p className="text-xs font-semibold text-text-secondary">Booked time</p>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between items-center">
          <span className="text-xs text-text-muted">{label}</span>
          <span className="text-xs font-medium text-text-primary tabular-nums" style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>{value}</span>
        </div>
      ))}
      {flagged && (
        <p className="text-xs text-amber-700 pt-1">Flagged for review: {ride.review_reason}</p>
      )}
    </div>
  )
}
