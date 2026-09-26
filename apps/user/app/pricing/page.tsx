import type { Metadata } from 'next'
import Link from 'next/link'
import { Info } from 'lucide-react'

import SiteShell from '@/components/site/SiteShell'

export const metadata: Metadata = {
  title: 'Fares and Services',
  description:
    'Ocar per-kilometre fares and minimum fares for one-way trips and round trips across Bhubaneswar, Cuttack and Puri, plus how hourly rentals are priced.',
  alternates: { canonical: '/pricing' },
}

// Rates are edited by admins and versioned in the database, so this page reads
// them live from the public rate-card endpoint (revalidated, not hardcoded).
// If the API is unreachable it falls back to the how-fares-work explanation
// with no numbers rather than showing stale or invented ones.
export const revalidate = 600

type ApiRateCard = {
  category_name: string
  category_slug: string
  ride_type: 'one_way' | 'round_trip' | 'rental'
  rate_per_km: number | string
  min_fare: number | string
  city_id: number | null
}

type Row = { category: string; slug: string; oneWay?: Fare; roundTrip?: Fare }
type Fare = { perKm: number; min: number }

const CATEGORY_ORDER = ['hatchback', 'sedan', 'suv', 'luxury', 'van']
const SEATS: Record<string, string> = {
  hatchback: 'Up to 4 passengers',
  sedan: 'Up to 4 passengers',
  suv: 'Up to 6 passengers',
  luxury: 'Up to 4 passengers',
  van: 'Up to 8 passengers',
}

async function loadRows(): Promise<Row[] | null> {
  const base = process.env['NEXT_PUBLIC_API_URL']
  if (!base) return null
  try {
    const res = await fetch(`${base}/api/v1/pricing/rate-cards`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const data: unknown = await res.json()
    if (!Array.isArray(data)) return null

    const byCat = new Map<string, Row>()
    for (const c of data as ApiRateCard[]) {
      if (c.city_id !== null) continue // city-specific overrides are shown at booking time
      if (c.ride_type === 'rental') continue
      const perKm = Number(c.rate_per_km)
      const min = Number(c.min_fare)
      if (!Number.isFinite(perKm) || !Number.isFinite(min)) continue
      const row = byCat.get(c.category_slug) ?? { category: c.category_name, slug: c.category_slug }
      if (c.ride_type === 'one_way') row.oneWay = { perKm, min }
      else row.roundTrip = { perKm, min }
      byCat.set(c.category_slug, row)
    }
    const rows = [...byCat.values()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a.slug)
      const ib = CATEGORY_ORDER.indexOf(b.slug)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    return rows.length > 0 ? rows : null
  } catch {
    return null
  }
}

const inr = (n: number) => `₹${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`

function FareCell({ fare }: { fare?: Fare }) {
  if (!fare) return <span className="text-text-muted">Not offered</span>
  return (
    <div>
      <p className="font-display text-[18px] font-semibold text-text-primary">{inr(fare.perKm)} / km</p>
      <p className="text-[12.5px] text-text-muted">Minimum fare {inr(fare.min)}</p>
    </div>
  )
}

export default async function PricingPage() {
  const rows = await loadRows()

  return (
    <SiteShell>
      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
          <h1 className="font-display text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
            Fares and services
          </h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-text-secondary">
            Ocar fares are set by distance, travel time and vehicle type. You see the estimate before you book,
            with no hidden charges added afterwards.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-16 px-4 py-12 sm:px-6 md:py-16">
        <section aria-labelledby="rates">
          <h2 id="rates" className="font-display text-2xl font-bold tracking-tight text-text-primary">
            Per-kilometre rates
          </h2>

          {rows ? (
            <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface">
              <div className="hidden grid-cols-[1.2fr_1fr_1fr] gap-4 border-b border-border bg-surface-2 px-6 py-3 text-[12.5px] font-semibold text-text-muted md:grid">
                <span>Vehicle</span>
                <span>One-way</span>
                <span>Round trip</span>
              </div>
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li key={r.slug} className="grid gap-4 px-6 py-5 md:grid-cols-[1.2fr_1fr_1fr] md:items-center">
                    <div>
                      <p className="font-display text-[19px] font-semibold text-text-primary">{r.category}</p>
                      <p className="text-[12.5px] text-text-muted">{SEATS[r.slug] ?? 'Verified driver included'}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-[12px] font-semibold text-text-muted md:hidden">One-way</p>
                      <FareCell fare={r.oneWay} />
                    </div>
                    <div>
                      <p className="mb-1 text-[12px] font-semibold text-text-muted md:hidden">Round trip</p>
                      <FareCell fare={r.roundTrip} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-text-secondary">
              Current per-kilometre rates for each vehicle type are shown in the app when you enter your pickup and
              drop, before you confirm a booking.
            </p>
          )}

          <p className="mt-4 flex max-w-3xl gap-2.5 text-[13px] leading-relaxed text-text-muted">
            <Info size={15} className="mt-0.5 flex-shrink-0 text-primary" />
            All amounts are in Indian rupees. These are base rates; your fare also reflects travel time, any stops
            you add, city-specific rates and high-demand periods, and is confirmed on screen before you book.
          </p>
        </section>

        <section aria-labelledby="how" className="grid gap-10 md:grid-cols-2">
          <div>
            <h2 id="how" className="font-display text-2xl font-bold tracking-tight text-text-primary">
              How each service is priced
            </h2>
            <dl className="mt-6 space-y-6">
              <div>
                <dt className="font-display text-[18px] font-semibold text-text-primary">One-way</dt>
                <dd className="mt-1.5 text-[14.5px] leading-relaxed text-text-secondary">
                  Distance travelled at the per-kilometre rate, plus time, subject to the minimum fare. Stops on the
                  way are priced along the real route.
                </dd>
              </div>
              <div>
                <dt className="font-display text-[18px] font-semibold text-text-primary">Round trip</dt>
                <dd className="mt-1.5 text-[14.5px] leading-relaxed text-text-secondary">
                  Outward and return legs with the same driver, with waiting time and any extra stops included in
                  the quoted fare.
                </dd>
              </div>
              <div>
                <dt className="font-display text-[18px] font-semibold text-text-primary">Hourly rental</dt>
                <dd className="mt-1.5 text-[14.5px] leading-relaxed text-text-secondary">
                  A fixed package fare for 1, 2, 4, 6, 8 or 10 hours with a kilometre allowance. Only distance or
                  time beyond the package, after a small grace allowance, is charged extra.
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-3xl bg-primary-subtle p-7 md:p-9">
            <h2 className="font-display text-2xl font-bold tracking-tight text-text-primary">Paying for a ride</h2>
            <ul className="mt-5 space-y-3 text-[14.5px] leading-relaxed text-text-secondary">
              <li>
                <span className="font-semibold text-text-primary">Cash</span> paid to the driver at the end of the trip.
              </li>
              <li>
                <span className="font-semibold text-text-primary">UPI, cards and net banking</span> paid securely
                through our RBI-authorised payment gateway partners.
              </li>
              <li>
                <span className="font-semibold text-text-primary">Ocar wallet</span> for one-tap payment from your
                balance.
              </li>
            </ul>
            <p className="mt-6 text-[13.5px] leading-relaxed text-text-secondary">
              Cancelling or disputing a charge? Read the{' '}
              <Link href="/legal/refund-cancellation" className="font-semibold text-primary-dark underline">
                Refund and Cancellation Policy
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </SiteShell>
  )
}
