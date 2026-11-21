import { describe, it, expect } from 'vitest'
import { buildReceipt, buildFareRows, money } from '@/modules/rides/receipt/receipt.model'
import { renderReceiptPdf } from '@/modules/rides/receipt/receipt.pdf'
import * as F from './receipt-fixtures'

const sum = (rows: Array<{ amount: number }>) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100

describe('receipt fare rows', () => {
  it('a plain city ride lists only what was charged, and adds up', () => {
    const { rows, payable } = buildFareRows(F.CITY_RIDE, [])
    expect(rows.map((r) => r.label)).toEqual(['Base fare', 'Distance', 'Time'])
    expect(sum(rows)).toBe(payable)
    expect(payable).toBe(217)
  })

  it('shows surge with its multiplier, the toll with its zone, pickup waiting with its free minutes and waiting at stops, and takes the offer off', () => {
    const { rows, gross, discount, payable } = buildFareRows(F.ONE_WAY_FULL, F.ONE_WAY_FULL_STOPS)
    const by = Object.fromEntries(rows.map((r) => [r.label, r]))
    expect(by['Surge']?.detail).toBe('1.2×')
    expect(by['Airport toll']?.detail).toBe('Biju Patnaik Airport')
    expect(by['Waiting at pickup']?.detail).toBe('5 min, after 3 free minutes')
    expect(by['Waiting at stops']?.amount).toBe(12)
    expect(by['Extra stops']?.detail).toBe('1 stop')
    expect(rows.find((r) => r.label === 'Adjustments')).toBeUndefined()
    expect(sum(rows)).toBe(gross)
    expect(discount).toBe(100)
    expect(payable).toBe(790.2)
  })

  it('a rental reads as package, extra distance and extra time (quantity x rate), not a lump', () => {
    const { rows, payable } = buildFareRows(F.RENTAL, F.RENTAL_STOPS)
    expect(rows[0]).toMatchObject({ label: 'Package price', detail: '4 h · 40 km included', amount: 1100 })
    expect(rows.find((r) => r.label === 'Extra distance')).toMatchObject({ detail: '12 km × ₹14', amount: 168 })
    expect(rows.find((r) => r.label === 'Extra time')).toMatchObject({ detail: '25 min × ₹2', amount: 50 })
    expect(rows.find((r) => r.label === 'Base fare')).toBeUndefined()
    expect(sum(rows)).toBe(payable)
  })

  it('a rental with no stored rates shows one honest extra line instead of a wrong split', () => {
    const { rows } = buildFareRows({ ...F.RENTAL, rental_extra_per_km: null, rental_extra_per_min: null }, F.RENTAL_STOPS)
    expect(rows.find((r) => r.label === 'Extra distance or time')?.amount).toBe(218)
  })

  it('an hourly round trip shows booked time and overtime after the grace; a per-day round trip shows the driver allowance', () => {
    const hourly = buildFareRows(F.ROUND_HOURLY, [])
    expect(hourly.rows.map((r) => r.label)).toEqual(['Distance', 'Booked time', 'Extra stops', 'Extra time', 'Airport toll'])
    expect(hourly.rows.find((r) => r.label === 'Extra time')?.detail).toBe('20 min, after 15 free minutes')
    expect(sum(hourly.rows)).toBe(hourly.payable)
    const daily = buildFareRows(F.ROUND_DAILY, [])
    expect(daily.rows.map((r) => r.label)).toEqual(['Base fare', 'Driver allowance', 'Distance', 'Extra distance or time', 'Airport toll'])
    expect(sum(daily.rows)).toBe(daily.payable)
  })

  it('an unexplained gap becomes an Adjustments row so the rows always match the total; sub-rupee rounding does not', () => {
    const gap = buildFareRows({ ...F.CITY_RIDE, total_final: '230' }, [])
    expect(gap.rows.at(-1)).toMatchObject({ label: 'Adjustments', amount: 13 })
    expect(sum(gap.rows)).toBe(230)
    const crumb = buildFareRows({ ...F.CITY_RIDE, total_final: '217.4' }, [])
    expect(crumb.rows.find((r) => r.label === 'Adjustments')).toBeUndefined()
  })
})

describe('receipt model', () => {
  it('cash is "Cash due" until collected, then "Paid"; online follows the payment status; never a hard-coded Paid', () => {
    expect(buildReceipt(F.CASH_DUE, [], []).status).toEqual({ text: 'Cash due', tone: 'due' })
    expect(buildReceipt(F.CASH_DUE, [], []).heroLabel).toBe('Total due')
    expect(buildReceipt(F.CITY_RIDE, [], []).status).toEqual({ text: 'Paid', tone: 'good' })
    expect(buildReceipt({ ...F.ONE_WAY_FULL, payment_status: 'pending' }, [], []).status).toEqual({ text: 'Payment pending', tone: 'due' })
    expect(buildReceipt({ ...F.ONE_WAY_FULL, payment_status: 'failed' }, [], []).status.text).toBe('Payment failed')
  })

  it('the hero total is what the rider pays (offer already off) and the offer is reported', () => {
    const m = buildReceipt(F.ONE_WAY_FULL, F.ONE_WAY_FULL_STOPS, [])
    expect(m.total).toBe(790.2)
    expect(m.saved).toBe(100)
    expect(m.sumLabel).toBe('Total paid')
  })

  it('a cancellation with a fee is its own receipt: the fee only, the reason, no trip facts', () => {
    const m = buildReceipt(F.CANCELLED_FEE, [], [])
    expect(m.kind).toBe('cancelled')
    expect(m.rows).toEqual([{ key: 'fee', label: 'Cancellation fee', amount: 50 }])
    expect(m.total).toBe(50)
    expect(m.note).toContain('Cancelled by you after the driver arrived')
    expect(m.timeline.map((t) => t.label)).toEqual(['Pickup', 'Drop'])
    expect(m.driver?.rating).toBeNull()
  })

  it('labels each ride type route its own way, with the pickup wait and each stop wait as notes', () => {
    const rental = buildReceipt({ ...F.RENTAL, pickup_wait_min: '8' }, F.RENTAL_STOPS, [])
    expect(rental.timeline.map((t) => t.label)).toEqual(['Picked up', 'Stop 1', 'Stop 2', 'Ended'])
    expect(rental.timeline[0]?.note).toBe('Driver waited 8 min at pickup')
    expect(rental.timeline[1]?.note).toBe('Waited 12 min')
    const round = buildReceipt(F.ROUND_HOURLY, [], [])
    expect(round.timeline.map((t) => t.label)).toEqual(['Left pickup', 'Reached destination', 'Back at pickup'])
    expect(buildReceipt(F.CITY_RIDE, [], []).timeline.map((t) => t.label)).toEqual(['Picked up', 'Dropped off'])
  })

  it('shows the rental package bars only when the ride ran over, and the booked-window bar for an hourly round trip that did', () => {
    const r = buildReceipt(F.RENTAL, F.RENTAL_STOPS, [])
    expect(r.package?.title).toBe('4 hour · 40 km package')
    expect(r.package?.bars.map((b) => b.label)).toEqual(['Distance', 'Time'])
    expect(buildReceipt({ ...F.RENTAL, actual_km: '30', actual_min: '200' }, [], []).package?.bars).toEqual([])
    expect(buildReceipt(F.ROUND_HOURLY, [], []).package?.title).toBe('Booked for 10 hours')
  })

  it('formats money like the app and times in India time', () => {
    expect(money(790.2)).toBe('₹790.20')
    expect(money(1100)).toBe('₹1,100')
    expect(buildReceipt(F.CITY_RIDE, [], []).timeline[0]?.time).toBe('3:22 pm')
  })

  it('keeps the trail only when it has a route to draw', () => {
    expect(buildReceipt(F.CITY_RIDE, [], [[20.2, 85.8]]).trail).toEqual([])
    expect(buildReceipt(F.CITY_RIDE, [], F.trail(10)).trail).toHaveLength(10)
  })
})

describe('receipt pdf', () => {
  const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

  it('renders every ride shape as a real PDF', async () => {
    const cases = [
      buildReceipt(F.CITY_RIDE, [], F.trail()),
      buildReceipt(F.CASH_DUE, [], F.trail()),
      buildReceipt(F.ONE_WAY_FULL, F.ONE_WAY_FULL_STOPS, F.trail()),
      buildReceipt(F.RENTAL, F.RENTAL_STOPS, F.trail()),
      buildReceipt(F.ROUND_HOURLY, [], F.trail()),
      buildReceipt(F.ROUND_DAILY, [], []),
      buildReceipt(F.CANCELLED_FEE, [], []),
    ]
    for (const m of cases) {
      const pdf = await renderReceiptPdf(m)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      expect(pdf.length).toBeGreaterThan(5_000)
    }
  })

  it('flows onto a second page when there are a lot of stops, instead of cutting them off', async () => {
    const one = await renderReceiptPdf(buildReceipt(F.CITY_RIDE, [], F.trail()))
    const many = await renderReceiptPdf(buildReceipt(F.MANY_STOPS_RIDE, F.MANY_STOPS, F.trail()))
    expect(pages(one)).toBe(1)
    expect(pages(many)).toBeGreaterThanOrEqual(2)
  })

  it('renders Odia addresses without throwing', async () => {
    const m = buildReceipt({ ...F.CITY_RIDE, origin_address: 'ଭୁବନେଶ୍ୱର ବିମାନବନ୍ଦର, ଭୁବନେଶ୍ୱର, ଓଡ଼ିଶା 751020' }, [], F.trail())
    expect((await renderReceiptPdf(m)).length).toBeGreaterThan(5_000)
  })
})
