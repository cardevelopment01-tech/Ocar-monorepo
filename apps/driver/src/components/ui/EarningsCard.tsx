interface EarningsCardProps {
  earnings: number
  trips: number
  rating: number
  hoursOnline: string
}

export default function EarningsCard({ earnings, trips, rating, hoursOnline }: EarningsCardProps) {
  return (
    <div className="bg-surface rounded-2xl border border-border overflow-hidden" style={{ borderTopColor: '#22C55E', borderTopWidth: 3 }}>
      <div className="p-5">
        <p className="text-text-muted text-xs font-medium mb-1 uppercase tracking-wider">Today's Earnings</p>
        <p className="text-[32px] font-bold text-text-primary leading-none mb-4">
          ₹{earnings.toLocaleString('en-IN')}
        </p>

        <div className="flex gap-2">
          <div className="flex items-center gap-1.5 bg-surface-3 rounded-full px-3 py-1.5">
            <span className="text-sm">🚗</span>
            <span className="text-sm font-semibold text-text-secondary">{trips} trips</span>
          </div>
          <div className="flex items-center gap-1.5 bg-surface-3 rounded-full px-3 py-1.5">
            <span className="text-sm">⭐</span>
            <span className="text-sm font-semibold text-text-secondary">{rating}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-surface-3 rounded-full px-3 py-1.5">
            <span className="text-sm">⏱</span>
            <span className="text-sm font-semibold text-text-secondary">{hoursOnline}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
