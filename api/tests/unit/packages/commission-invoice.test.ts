import { describe, expect, it } from 'vitest'
import { closedPeriods, commissionDescription, parseFrequency, taxFromInclusive } from '@/modules/packages/commission-invoice'
import { formatInvoiceNo, splitTax } from '@/modules/packages/package-invoice'

// Value: protects=a driver's commission invoice covers exactly the rides cut in its period and the GST is backed out of the amount that was
// really deducted (never added on top); fails_when=a ride settled at 11:59pm IST on the last day lands in the next period, the GST on
// ₹3,600 comes out a paisa off, a mistyped period setting stops invoicing, or the commission number runs into the package series;
// why_new=commission is deducted tax-inclusive, so it needs its own invoice; seam=none (pure rules); no_claim=the database query or the PDF.

describe('taxFromInclusive', () => {
  it('backs 18% out of the commission: ₹30 is 25.42 + 4.58', () => {
    expect(taxFromInclusive(30, 18)).toEqual({ taxable: 25.42, gst: 4.58 })
  })
  it('works on the period total, so 120 rides cut ₹3,600 is 3,050.85 + 549.15', () => {
    expect(taxFromInclusive(3600, 18)).toEqual({ taxable: 3050.85, gst: 549.15 })
  })
  it('always adds back to exactly what was deducted', () => {
    for (const gross of [0.01, 1, 7.5, 29.99, 30, 1234.56, 99999.99]) {
      const { taxable, gst } = taxFromInclusive(gross, 18)
      expect(Math.round((taxable + gst) * 100)).toBe(Math.round(gross * 100))
    }
  })
  it('a different rate changes only the split, not the total', () => {
    expect(taxFromInclusive(118, 18)).toEqual({ taxable: 100, gst: 18 })
    expect(taxFromInclusive(105, 5)).toEqual({ taxable: 100, gst: 5 })
    expect(taxFromInclusive(100, 0)).toEqual({ taxable: 100, gst: 0 })
  })
  it('feeds the same CGST / SGST / IGST split as a package invoice', () => {
    const { taxable, gst } = taxFromInclusive(3600, 18)
    const intra = splitTax(taxable, gst, 18, true)
    expect(intra).toMatchObject({ cgst: 274.58, sgst: 274.57, total: 3600 }) // odd paisa goes to CGST
    expect(splitTax(taxable, gst, 18, false)).toMatchObject({ igstAmount: 549.15, total: 3600 })
  })
})

describe('closedPeriods, monthly', () => {
  it('on 22 Nov 2026 the latest closed month is October 2026, IST to IST', () => {
    const [p] = closedPeriods(new Date('2026-11-22T10:00:00Z'), 'monthly', 1)
    expect(p!.label).toBe('October 2026')
    expect(p!.startDate).toBe('2026-10-01')
    expect(p!.endDate).toBe('2026-10-31')
    expect(p!.start.toISOString()).toBe('2026-09-30T18:30:00.000Z') // 00:00 IST on 1 Oct
    expect(p!.end.toISOString()).toBe('2026-10-31T18:30:00.000Z')   // 00:00 IST on 1 Nov
  })
  it('lists newest first and walks back across a year end', () => {
    const ps = closedPeriods(new Date('2027-01-05T10:00:00Z'), 'monthly', 3)
    expect(ps.map((p) => p.label)).toEqual(['December 2026', 'November 2026', 'October 2026'])
  })
  it('the first day of a month in IST already closes the month before, even though UTC is still the old day', () => {
    // 00:30 IST on 1 Dec 2026 is 19:00 UTC on 30 Nov
    const [p] = closedPeriods(new Date('2026-11-30T19:00:00Z'), 'monthly', 1)
    expect(p!.label).toBe('November 2026')
  })
  it('the last minute of the month in IST has not closed it yet', () => {
    const [p] = closedPeriods(new Date('2026-11-30T18:29:00Z'), 'monthly', 1) // 23:59 IST on 30 Nov
    expect(p!.label).toBe('October 2026')
  })
  it('February in a leap year ends on the 29th', () => {
    const [p] = closedPeriods(new Date('2028-03-10T10:00:00Z'), 'monthly', 1)
    expect(p!.endDate).toBe('2028-02-29')
  })
})

describe('closedPeriods, weekly', () => {
  it('Monday to Sunday: on Sunday 22 Nov 2026 the last closed week is 9 to 15 Nov', () => {
    const [p] = closedPeriods(new Date('2026-11-22T10:00:00Z'), 'weekly', 1)
    expect(p!.startDate).toBe('2026-11-09')
    expect(p!.endDate).toBe('2026-11-15')
    expect(p!.label).toBe('9 Nov to 15 Nov 2026')
  })
  it('on Monday morning IST the week that just ended is closed', () => {
    const [p] = closedPeriods(new Date('2026-11-22T19:00:00Z'), 'weekly', 1) // 00:30 IST Mon 23 Nov
    expect(p!.startDate).toBe('2026-11-16')
    expect(p!.endDate).toBe('2026-11-22')
  })
  it('consecutive weeks do not overlap or leave a gap', () => {
    const ps = closedPeriods(new Date('2026-11-22T10:00:00Z'), 'weekly', 4)
    for (let i = 0; i < ps.length - 1; i++) expect(ps[i + 1]!.end.getTime()).toBe(ps[i]!.start.getTime())
  })
})

describe('parseFrequency', () => {
  it('weekly only when it says so; anything else is monthly', () => {
    expect(parseFrequency('weekly')).toBe('weekly')
    expect(parseFrequency(' Weekly ')).toBe('weekly')
    expect(parseFrequency('monthly')).toBe('monthly')
    expect(parseFrequency('fortnightly')).toBe('monthly')
    expect(parseFrequency(null)).toBe('monthly')
  })
})

describe('commission invoice number and description', () => {
  it('has its own CM series and stays within 16 characters', () => {
    expect(formatInvoiceNo('2627', 7, 'CM')).toBe('CM/2627/000007')
    expect(formatInvoiceNo('2627', 7)).toBe('PK/2627/000007')
    expect(formatInvoiceNo('2627', 999_999, 'CM').length).toBeLessThanOrEqual(16)
  })
  it('names the period and the ride count', () => {
    expect(commissionDescription({ label: 'October 2026' }, 120)).toBe('Platform service fee (commission) on 120 rides, October 2026')
    expect(commissionDescription({ label: 'October 2026' }, 1)).toBe('Platform service fee (commission) on 1 ride, October 2026')
  })
})
