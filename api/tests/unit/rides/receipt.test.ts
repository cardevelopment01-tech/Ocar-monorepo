import { describe, it, expect } from 'vitest'
import { buildReceipt, buildFareRows, money } from '@/modules/rides/receipt/receipt.model'
import { renderReceiptPdf } from '@/modules/rides/receipt/receipt.pdf'
import * as F from './receipt-fixtures'

const sum = (rows: Array<{ amount: number }>) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100

describe('receipt fare rows', () => {
  it('a plain city ride is one Ride fare line, and adds up', () => {
    const { rows, payable } = buildFareRows(F.CITY_RIDE, [])
    expect(rows).toEqual([{ key: 'ride-fare', label: 'Ride fare', detail: '10.7 km · 27 min', amount: 217 }])
    expect(sum(rows)).toBe(payable)
    expect(payable).toBe(217)
  })

  it("prd ride 1177: the ride fare comes from the settled total, not the stale quoted components (no -193.26 'Adjustments')", () => {
    // Quoted for 20.7 km: base 95 + distance 415.04 + time 153 + stops 110 = 773.04 (still on the snapshot). Driven 12.87 km / 31 min,
    // settled at 620.78 including the 40 toll and 1 pickup wait. Adding the stale components printed 814.04 and an Adjustments row.
    const ride = {
      ...F.CITY_RIDE, id: '1177', total_estimated: '773.04', total_final: '620.78', base_fare: '95', distance_fare: '415.04', time_fare: '153', stop_fare: '110',
      toll_charge: '40', toll_detail: [{ zone: 'Biju Pattanaik International Airport, Bhubaneswar', amount: 40 }],
      pickup_wait_min: '3.40', pickup_free_wait_min: 3, pickup_wait_charge: '1', actual_km: '12.87', actual_min: '30.91',
    }
    const stops = [
      { sequence: 1, address: 'A', status: 'reached', stop_charge_applied: '55' },
      { sequence: 2, address: 'B', status: 'reached', stop_charge_applied: '55' },
    ]
    const { rows, payable } = buildFareRows(ride, stops)
    expect(rows.map((r) => [r.label, r.amount])).toEqual([['Ride fare', 580.78], ['Airport toll', 40]])
    expect(rows[0]?.detail).toBe('12.87 km · 31 min · 2 stops · incl. ₹1 waiting')
    expect(rows.find((r) => r.label === 'Adjustments')).toBeUndefined()
    expect(sum(rows)).toBe(620.78)
    expect(payable).toBe(620.78)
    expect(buildReceipt(ride, stops, []).sumLabel).toBe('Total ride fare')
  })

  it('folds surge, waiting and stops into the Ride fare, lists the toll with its zone below it, and takes the offer off', () => {
    const { rows, gross, discount, payable } = buildFareRows(F.ONE_WAY_FULL, F.ONE_WAY_FULL_STOPS)
    expect(rows.map((r) => r.label)).toEqual(['Ride fare', 'Airport toll'])
    expect(rows[0]).toMatchObject({ detail: '28.4 km · 55 min · 1 stop · 1.2× surge · incl. ₹27 waiting', amount: 850.2 })
    expect(rows[1]).toMatchObject({ detail: 'Biju Patnaik Airport', amount: 40 })
    expect(rows.find((r) => r.label === 'Adjustments')).toBeUndefined()
    expect(sum(rows)).toBe(gross)
    expect(discount).toBe(100)
    expect(payable).toBe(790.2)
  })

  it('a rental is the Ride fare (with its package in the detail), then toll, extra distance and extra time (quantity x rate) below it', () => {
    const { rows, payable } = buildFareRows(F.RENTAL, F.RENTAL_STOPS)
    expect(rows.map((r) => r.label)).toEqual(['Ride fare', 'Airport toll', 'Extra distance', 'Extra time'])
    expect(rows[0]).toMatchObject({ detail: '4 h · 40 km included · 2 stops · incl. ₹69 waiting', amount: 1229 })
    expect(rows.find((r) => r.label === 'Extra distance')).toMatchObject({ detail: '12 km × ₹14', amount: 168 })
    expect(rows.find((r) => r.label === 'Extra time')).toMatchObject({ detail: '25 min × ₹2', amount: 50 })
    expect(rows.find((r) => r.label === 'Base fare' || r.label === 'Package price')).toBeUndefined()
    expect(sum(rows)).toBe(payable)
  })

  it('a rental with no stored rates shows one honest extra line instead of a wrong split', () => {
    const { rows } = buildFareRows({ ...F.RENTAL, rental_extra_per_km: null, rental_extra_per_min: null }, F.RENTAL_STOPS)
    expect(rows.find((r) => r.label === 'Extra distance or time')?.amount).toBe(218)
  })

  it('an hourly round trip keeps booked time inside the Ride fare and shows overtime (after the grace) and the toll below it; a per-day one keeps its extra distance inside the Ride fare', () => {
    const hourly = buildFareRows(F.ROUND_HOURLY, [])
    expect(hourly.rows.map((r) => r.label)).toEqual(['Ride fare', 'Airport toll', 'Extra time'])
    expect(hourly.rows[0]).toMatchObject({ detail: '142 km · 620 min · 10 hours booked', amount: 3234 })
    expect(hourly.rows.find((r) => r.label === 'Extra time')).toMatchObject({ detail: '20 min, after 15 free minutes', amount: 100 })
    expect(sum(hourly.rows)).toBe(hourly.payable)
    const daily = buildFareRows(F.ROUND_DAILY, [])
    // its overage_fare is the quoted figure (settlement reprices the total, not that column), so it is not itemised: all of it stays in the Ride fare
    // the per-day driver allowance (hour_surcharge 800) is listed below the Ride fare, not inside it
    expect(daily.rows.map((r) => [r.label, r.amount])).toEqual([['Ride fare', 4792], ['Airport toll', 220], ['Driver allowance', 800]])
    expect(sum(daily.rows)).toBe(daily.payable)
  })

  it('a night allowance is listed last, below the Ride fare, with its nights and rate, and everything still adds up', () => {
    const ride = { ...F.ROUND_DAILY, total_final: '6112', night_allowance: '300', night_count: 1 } // 5812 + 300
    const { rows, payable } = buildFareRows(ride, [])
    expect(rows.map((r) => [r.label, r.amount])).toEqual([['Ride fare', 4792], ['Airport toll', 220], ['Driver allowance', 800], ['Night allowance', 300]])
    expect(rows.at(-1)?.detail).toBe('1 night × ₹300')
    expect(sum(rows)).toBe(payable)
  })

  it('two nights read "2 nights", and a ride with none shows no night line', () => {
    const two = buildFareRows({ ...F.ROUND_DAILY, total_final: '6412', night_allowance: '600', night_count: 2 }, [])
    expect(two.rows.at(-1)).toMatchObject({ label: 'Night allowance', amount: 600, detail: '2 nights × ₹300' })
    expect(buildFareRows(F.ROUND_DAILY, []).rows.some((r) => r.label === 'Night allowance')).toBe(false)
  })

  it('whatever the settled total is, the Ride fare takes it up, so the rows always match it', () => {
    for (const total of ['230', '217.4', '150']) {
      const { rows, payable } = buildFareRows({ ...F.CITY_RIDE, total_final: total }, [])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ label: 'Ride fare', amount: Number(total) })
      expect(sum(rows)).toBe(payable)
    }
  })

  it('only when the charges listed below exceed the total does an Adjustments row appear, so the rows still match it', () => {
    const odd = buildFareRows({ ...F.CITY_RIDE, total_final: '30', toll_charge: '40' }, [])
    expect(odd.rows.map((r) => [r.label, r.amount])).toEqual([['Airport toll', 40], ['Adjustments', -10]])
    expect(sum(odd.rows)).toBe(30)
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
    expect(m.sumLabel).toBe('Total paid') // with an offer, the closing line is what is paid; "Total ride fare" is the line before the offer
    expect(buildReceipt(F.CITY_RIDE, [], []).sumLabel).toBe('Total ride fare')
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

  it('counts the stops that were charged, not just the ones made (a charge stays after a skip)', () => {
    const stops = [
      { sequence: 1, address: 'A', status: 'reached', stop_charge_applied: '30' },
      { sequence: 2, address: 'B', status: 'skipped', stop_charge_applied: '30' },
    ]
    const { rows } = buildFareRows({ ...F.CITY_RIDE, stop_fare: '60', total_final: '277' }, stops)
    expect(rows[0]?.detail).toBe('10.7 km · 27 min · 2 stops')
  })

  it('drops a stray (0,0) or out-of-range GPS fix so it cannot shrink the route', () => {
    const t = buildReceipt(F.CITY_RIDE, [], [[0, 0], [20.2, 85.8], [20.3, 85.9], [95, 10], [Number.NaN, 1]]).trail
    expect(t).toEqual([[20.2, 85.8], [20.3, 85.9]])
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

  it('draws an address mixing Latin and Odia in both fonts (neither script falls back to blank boxes)', async () => {
    const m = buildReceipt({ ...F.CITY_RIDE, user_name: 'ସୁଜଲ Ghosh', origin_address: 'Plot 12, Jayadev Vihar, ଭୁବନେଶ୍ୱର, Odisha 751013' }, [], F.trail())
    const pdf = (await renderReceiptPdf(m)).toString('latin1')
    expect(pdf).toMatch(/PlusJakartaSans/)
    expect(pdf).toMatch(/NotoSansOriya/)
  })

  it('renders Odia addresses without throwing', async () => {
    const m = buildReceipt({ ...F.CITY_RIDE, origin_address: 'ଭୁବନେଶ୍ୱର ବିମାନବନ୍ଦର, ଭୁବନେଶ୍ୱର, ଓଡ଼ିଶା 751020' }, [], F.trail())
    expect((await renderReceiptPdf(m)).length).toBeGreaterThan(5_000)
  })
})
