import { Clock } from 'lucide-react'

// Booked hours stay visible on every round-trip stage so the driver never has to remember them.
export default function RoundTripBanner({ hours }: { hours: number | null | undefined }) {
  if (hours == null) return null
  return (
    <div className="flex items-center gap-2 mt-3 mb-3 px-3 py-2 rounded-xl bg-primary-subtle">
      <Clock size={11} className="flex-shrink-0 text-primary-dark" aria-hidden />
      <p className="text-xs font-semibold text-primary-dark">Round trip · {hours}h booked</p>
    </div>
  )
}
