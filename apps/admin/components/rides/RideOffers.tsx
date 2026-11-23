'use client'
import Link from 'next/link'
import type { AdminRideOffer } from '@/lib/admin-api'
import { elapsed, fmtIst } from '@/lib/ist'

const PILL: Record<AdminRideOffer['status'], string> = {
  accepted: 'pill-success', declined: 'pill-danger', expired: 'pill-warning', offered: 'pill-info', cancelled: 'pill-muted',
}

/** One line that answers "why did nobody take this ride?": how many were asked and what they did. */
export function offerSummary(offers: AdminRideOffer[]): string {
  if (offers.length === 0) return 'No driver was offered this ride'
  const count = (s: AdminRideOffer['status']) => offers.filter(o => o.status === s).length
  const rounds = new Set(offers.map(o => o.broadcast_round)).size
  const parts = (['accepted', 'declined', 'expired', 'offered', 'cancelled'] as const)
    .map(s => [s, count(s)] as const).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s === 'offered' ? 'waiting' : s}`)
  return `${offers.length} driver${offers.length === 1 ? '' : 's'} offered over ${rounds} round${rounds === 1 ? '' : 's'}: ${parts.join(', ')}`
}

export default function RideOffers({ offers }: { offers: AdminRideOffer[] }) {
  if (offers.length === 0) return <p className="text-xs text-text-muted">{offerSummary(offers)}. Either no driver was online nearby, or the ride was assigned by an admin.</p>
  const rounds = [...new Set(offers.map(o => o.broadcast_round))].sort((a, b) => a - b)
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-text-primary">{offerSummary(offers)}</p>
      {rounds.map(round => (
        <div key={round}>
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">Round {round}</p>
          <ul className="divide-y divide-border-light">
            {offers.filter(o => o.broadcast_round === round).map(o => {
              const reply = elapsed(o.offered_at, o.responded_at)
              const ack = elapsed(o.offered_at, o.acked_at)
              return (
                <li key={o.id} className="py-1.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/drivers/${o.driver_id}`} className="text-xs font-medium text-text-primary hover:underline truncate block">
                      {o.driver_name ?? o.driver_phone}
                    </Link>
                    <p className="text-[11px] text-text-muted">
                      {fmtIst(o.offered_at)}
                      {o.distance_km != null ? ` · ${o.distance_km.toFixed(1)} km away` : ''}
                      {/* Never confirmed by the app: the phone may not have received it at all, which is a different problem from a driver ignoring it. */}
                      {o.acked_at == null && o.status !== 'cancelled' ? ' · app did not confirm receipt' : ack ? ` · app confirmed in ${ack}` : ''}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={PILL[o.status]}>{o.status === 'offered' ? 'Waiting' : o.status.charAt(0).toUpperCase() + o.status.slice(1)}</span>
                    {reply && o.status !== 'expired' && <p className="text-[11px] text-text-muted mt-0.5">after {reply}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
