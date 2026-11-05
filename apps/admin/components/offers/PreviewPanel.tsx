'use client'
import { useEffect, useRef, useState } from 'react'
import { offersApi, type DraftPreview, type SampleRide } from '@/lib/offers-api'
import { benefitOf, type Draft } from '@/lib/offers-model'
import { inputCls, type Lookups } from './RuleBuilder'

type Outcome = { kind: 'idle' } | { kind: 'loading' } | { kind: 'incomplete' } | { kind: 'ok'; data: DraftPreview }

/**
 * The live sentence an admin reads to check the offer says what they meant, and a sample ride showing what a rider
 * with that fare would see. Both come from the server (describeOffer and the same engine that prices bookings), so
 * there is no second copy of the wording or the maths here. Nothing is saved.
 */
export default function PreviewPanel({ draft, lookups }: { draft: Draft; lookups: Lookups }) {
  const [fare, setFare] = useState('454')
  const [channel, setChannel] = useState<'cash' | 'online' | 'wallet'>('online')
  const [rides, setRides] = useState('0')
  const [rideType, setRideType] = useState<'one_way' | 'round_trip' | 'rental'>('one_way')
  const [category, setCategory] = useState('')
  const [fromCity, setFromCity] = useState('')
  const [toCity, setToCity] = useState('')
  const [out, setOut] = useState<Outcome>({ kind: 'idle' })
  const latest = useRef(0)

  const signature = JSON.stringify([draft.rules, benefitOf(draft), fare, channel, rides, rideType, category, fromCity, toCity])
  useEffect(() => {
    const mine = ++latest.current
    setOut({ kind: 'loading' })
    const timer = setTimeout(async () => {
      const base = Number(fare)
      const sample: SampleRide | undefined = Number.isFinite(base) && base > 0
        ? { fare: { base, distance: 0, time: 0, stop: 0, hourSurcharge: 0, waiting: 0, surge: 0, overage: 0 }, ride: sampleRide(), completedRides: Number(rides) || 0 }
        : undefined
      function sampleRide(): SampleRide['ride'] {
        // The conditions an admin sets (city, route, category, ride type) can only be tried against a ride that has them.
        const ride: SampleRide['ride'] = { rideType, paymentChannel: channel }
        if (category) ride.categoryId = Number(category)
        if (fromCity) { ride.cityId = Number(fromCity); ride.originCityId = Number(fromCity) }
        if (toCity) ride.destinationCityId = Number(toCity)
        return ride
      }
      try {
        const data = await offersApi.previewDraft(sample ? { rules: draft.rules, benefit: benefitOf(draft), sample } : { rules: draft.rules, benefit: benefitOf(draft) })
        if (mine === latest.current) setOut({ kind: 'ok', data })
      } catch {
        // A half-filled form is a 422; that is "not ready yet", not an error to shout about.
        if (mine === latest.current) setOut({ kind: 'incomplete' })
      }
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const data = out.kind === 'ok' ? out.data : null
  const sample = data && data.eligible !== undefined ? data : null
  return (
    <aside aria-label="Offer preview" className="admin-card space-y-4 lg:sticky lg:top-4">
      <div>
        <h2 className="text-sm font-bold text-text-primary">What riders will read</h2>
        <p aria-live="polite" className="mt-2 text-base font-semibold text-text-primary min-h-[1.5rem]">
          {out.kind === 'incomplete' || out.kind === 'idle' ? <span className="text-text-muted font-normal text-sm">Fill in the discount to see a summary.</span>
            : data ? data.summary : <span className="text-text-muted font-normal text-sm">Checking…</span>}
        </p>
      </div>

      <div className="border-t border-border-light pt-4 space-y-3">
        <h3 className="text-sm font-bold text-text-primary">Preview as a rider</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pv-fare" className="block text-xs font-semibold text-text-muted mb-1.5">Fare (₹)</label>
            <input id="pv-fare" type="number" min="0" className={inputCls} value={fare} onChange={(e) => setFare(e.target.value)} />
          </div>
          <div>
            <label htmlFor="pv-rides" className="block text-xs font-semibold text-text-muted mb-1.5">Rides done</label>
            <input id="pv-rides" type="number" min="0" className={inputCls} value={rides} onChange={(e) => setRides(e.target.value)} />
          </div>
          <div>
            <label htmlFor="pv-type" className="block text-xs font-semibold text-text-muted mb-1.5">Ride type</label>
            <select id="pv-type" className={inputCls} value={rideType} onChange={(e) => setRideType(e.target.value as typeof rideType)}>
              <option value="one_way">One way</option><option value="round_trip">Round trip</option><option value="rental">Rental</option>
            </select>
          </div>
          <div>
            <label htmlFor="pv-cat" className="block text-xs font-semibold text-text-muted mb-1.5">Vehicle</label>
            <select id="pv-cat" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Any</option>
              {lookups.categoryIds.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pv-from" className="block text-xs font-semibold text-text-muted mb-1.5">From city</label>
            <select id="pv-from" className={inputCls} value={fromCity} onChange={(e) => setFromCity(e.target.value)}>
              <option value="">Any</option>
              {lookups.cityIds.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pv-to" className="block text-xs font-semibold text-text-muted mb-1.5">To city</label>
            <select id="pv-to" className={inputCls} value={toCity} onChange={(e) => setToCity(e.target.value)}>
              <option value="">Any</option>
              {lookups.cityIds.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label htmlFor="pv-channel" className="block text-xs font-semibold text-text-muted mb-1.5">Pays by</label>
            <select id="pv-channel" className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              <option value="online">Online</option><option value="wallet">Wallet</option><option value="cash">Cash</option>
            </select>
          </div>
        </div>
        <div aria-live="polite" className="rounded-xl bg-surface-2 p-3 text-sm min-h-[3.5rem]">
          {!sample ? <span className="text-text-muted">Enter a fare to try it.</span>
            : sample.eligible ? (
              <span>
                <span className="text-text-muted line-through mr-2">₹{Number(fare).toLocaleString('en-IN')}</span>
                <span className="font-bold text-text-primary">₹{Math.max(Number(fare) - (sample.discount ?? 0), 0).toLocaleString('en-IN')}</span>
                <span className="block text-success text-xs font-semibold mt-1">Rider saves ₹{(sample.discount ?? 0).toLocaleString('en-IN')}</span>
              </span>
            ) : <span className="text-text-secondary">Not applied: {sample.message ?? 'does not fit this ride'}</span>}
        </div>
        <p className="text-xs text-text-muted">Uses today&apos;s limits from System Config. It only shows the conditions you have set here, not budget or live availability.</p>
      </div>
    </aside>
  )
}
