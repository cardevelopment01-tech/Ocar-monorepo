// Mirrors apps/user/app/(main)/ride/[id]/page.tsx's STATUS_CONFIG exactly --
// same labels, same dot colors -- so the rider sees identical copy on web and mobile.
export type StatusKey =
  | 'scheduled' | 'requested' | 'accepted' | 'driver_arrived'
  | 'in_progress' | 'returning' | 'completed' | 'cancelled' | 'no_drivers'

export const STATUS_CONFIG: Record<StatusKey, { label: string; sub?: string; dot: string; dotPulse: boolean }> = {
  scheduled:      { label: 'Ride scheduled',       sub: "We'll find a driver closer to the time", dot: '#0A9FB0', dotPulse: false },
  requested:      { label: 'Finding your driver',  sub: 'Usually ready in 15–60 seconds',         dot: '#F59E0B', dotPulse: true },
  accepted:       { label: 'Driver is on the way', dot: '#2563EB', dotPulse: false },
  driver_arrived: { label: 'Driver has arrived!',  sub: 'Head to your pickup point',              dot: '#16A34A', dotPulse: true },
  in_progress:    { label: 'On the way to destination', dot: '#2563EB', dotPulse: false },
  returning:      { label: 'Driver is heading back', sub: 'Returning to pickup point',             dot: '#2563EB', dotPulse: false },
  completed:      { label: 'You have arrived!',    dot: '#16A34A', dotPulse: false },
  cancelled:      { label: 'Ride cancelled',       sub: 'Returning to home…',                     dot: '#DC2626', dotPulse: false },
  no_drivers:     { label: 'No drivers available', sub: 'Please try again in a moment',           dot: '#DC2626', dotPulse: false },
}

export function statusBg(status: StatusKey): { bg: string; border: string } {
  if (status === 'requested') return { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.22)' }
  if (status === 'driver_arrived' || status === 'completed') return { bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.22)' }
  if (status === 'cancelled' || status === 'no_drivers') return { bg: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.22)' }
  return { bg: 'rgba(37,99,235,0.07)', border: 'rgba(37,99,235,0.18)' }
}
