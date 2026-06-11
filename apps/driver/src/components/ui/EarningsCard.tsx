import { IndianRupee, Star, Car, Clock } from 'lucide-react'

interface EarningsCardProps {
  earnings: number
  trips: number
  rating: number
  hoursOnline: string
}

export default function EarningsCard({ earnings, trips, rating, hoursOnline }: EarningsCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-border overflow-hidden" style={{ borderLeftColor: '#2563EB', borderLeftWidth: 3 }}>
      <div className="p-5">
        <p className="text-text-muted text-[11px] font-bold mb-1 uppercase tracking-widest">Today's Earnings</p>
        <div className="flex items-center gap-1 mb-4">
          <IndianRupee size={22} className="text-text-primary flex-shrink-0" aria-hidden="true" />
          <p className="text-[32px] font-black text-text-primary leading-none tabular-nums">
            {earnings.toLocaleString('en-IN')}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.14)' }}
          >
            <Car size={12} className="text-primary" aria-hidden="true" />
            <span className="text-xs font-semibold text-primary">{trips} trips</span>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ background: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.14)' }}
          >
            <Star size={12} className="text-accent-amber fill-accent-amber" aria-hidden="true" />
            <span className="text-xs font-semibold text-accent-amber">{rating}</span>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}
          >
            <Clock size={12} className="text-text-muted" aria-hidden="true" />
            <span className="text-xs font-semibold text-text-secondary">{hoursOnline}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
