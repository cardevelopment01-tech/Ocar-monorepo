// Same labels as apps/user/app/(main)/ride/[id]/page.tsx's STATUS_CONFIG; dot / tint colours are the
// rider brand palette (teal in motion, live-green on arrival, gold while searching, red on failure).
export type StatusKey =
  | 'scheduled' | 'requested' | 'accepted' | 'driver_arrived'
  | 'in_progress' | 'returning' | 'completed' | 'cancelled' | 'no_drivers'

export const STATUS_CONFIG: Record<StatusKey, { label: string; sub?: string; dot: string; dotPulse: boolean }> = {
  scheduled:      { label: 'Ride scheduled',       sub: "We'll find a driver closer to the time", dot: '#0E8FA3', dotPulse: false },
  requested:      { label: 'Finding your driver',  sub: 'Usually ready in 15–60 seconds',         dot: '#D6A552', dotPulse: true },
  accepted:       { label: 'Driver is on the way', dot: '#0E8FA3', dotPulse: false },
  driver_arrived: { label: 'Driver has arrived!',  sub: 'Head to your pickup point',              dot: '#25B87A', dotPulse: true },
  in_progress:    { label: 'On the way to destination', dot: '#0E8FA3', dotPulse: false },
  returning:      { label: 'Driver is heading back', sub: 'Returning to pickup point',             dot: '#0E8FA3', dotPulse: false },
  completed:      { label: 'You have arrived!',    dot: '#25B87A', dotPulse: false },
  cancelled:      { label: 'Ride cancelled',       sub: 'Returning to home…',                     dot: '#E5484D', dotPulse: false },
  no_drivers:     { label: 'No drivers available', sub: 'Please try again in a moment',           dot: '#E5484D', dotPulse: false },
}

export function statusBg(status: StatusKey): { bg: string; border: string } {
  if (status === 'requested') return { bg: 'rgba(214,165,82,0.10)', border: 'rgba(214,165,82,0.28)' }
  if (status === 'driver_arrived' || status === 'completed') return { bg: 'rgba(37,184,122,0.09)', border: 'rgba(37,184,122,0.26)' }
  if (status === 'cancelled' || status === 'no_drivers') return { bg: 'rgba(229,72,77,0.08)', border: 'rgba(229,72,77,0.22)' }
  return { bg: 'rgba(14,143,163,0.07)', border: 'rgba(14,143,163,0.20)' }
}
