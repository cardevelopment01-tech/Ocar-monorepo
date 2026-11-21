import { describe, expect, it } from 'vitest'
import {
  fyCodeOf, formatInvoiceNo, invoiceDescription, isValidGstin, rupeesInWords, signInvoiceLink, splitTax, stateCodeOf, verifyInvoiceLink,
} from '@/modules/packages/package-invoice'

// Value: protects=the GST invoice a driver is given is legally well-formed: the right tax split for where they live, a number that fits the
// 16-character rule, a financial year that rolls over on 1 April IST, and a download link nobody can forge or reuse after it expires;
// fails_when=an Odisha driver is charged IGST, a ₹7.20 tax comes out as ₹7.19 + ₹3.60, an invoice number passes 16 characters, 31 March
// 11pm IST lands in the wrong year, or an edited link opens someone else's invoice; why_new=drivers now pay GST on plans and must get a
// tax invoice; seam=none (pure rules); no_claim=the PDF layout or the database numbering.

describe('stateCodeOf', () => {
  it('maps the names drivers type, ignoring case, spacing and old spellings', () => {
    expect(stateCodeOf('Odisha')).toBe('21')
    expect(stateCodeOf('  ODISHA ')).toBe('21')
    expect(stateCodeOf('Orissa')).toBe('21')
    expect(stateCodeOf('West  Bengal')).toBe('19')
    expect(stateCodeOf('Jammu & Kashmir')).toBe('01')
  })
  it('is null for blank or unknown, never a guess', () => {
    expect(stateCodeOf('')).toBeNull()
    expect(stateCodeOf(null)).toBeNull()
    expect(stateCodeOf('Atlantis')).toBeNull()
  })
})

describe('isValidGstin', () => {
  it('accepts a well-formed GSTIN and rejects the rest', () => {
    expect(isValidGstin('21ABCDE1234F1Z5')).toBe(true)
    expect(isValidGstin('21ABCDE1234F1Z')).toBe(false)
    expect(isValidGstin('21abcde1234f1z5')).toBe(false)
    expect(isValidGstin('')).toBe(false)
  })
})

describe('fyCodeOf', () => {
  it('runs April to March by the Indian calendar', () => {
    expect(fyCodeOf(new Date('2026-11-22T10:00:00Z'))).toBe('2627')
    expect(fyCodeOf(new Date('2027-02-10T10:00:00Z'))).toBe('2627')
    expect(fyCodeOf(new Date('2026-04-01T00:00:00+05:30'))).toBe('2627')
  })
  it('rolls over at midnight IST, not UTC', () => {
    expect(fyCodeOf(new Date('2027-03-31T23:00:00+05:30'))).toBe('2627')
    expect(fyCodeOf(new Date('2027-04-01T00:30:00+05:30'))).toBe('2728')
    expect(fyCodeOf(new Date('2027-03-31T19:00:00Z'))).toBe('2728') // 00:30 on 1 April in IST
  })
})

describe('formatInvoiceNo', () => {
  it('is consecutive-friendly and never longer than 16 characters', () => {
    expect(formatInvoiceNo('2627', 1)).toBe('PK/2627/000001')
    expect(formatInvoiceNo('2627', 999_999)).toBe('PK/2627/999999')
    expect(formatInvoiceNo('2627', 999_999).length).toBeLessThanOrEqual(16)
  })
  it('refuses a number it cannot fit', () => {
    expect(() => formatInvoiceNo('2627', 0)).toThrow()
    expect(() => formatInvoiceNo('2627', 1_000_000)).toThrow()
  })
})

describe('splitTax', () => {
  it('same state: CGST and SGST at half the rate each, adding to the tax paid', () => {
    const s = splitTax(40, 7.2, 18, true)
    expect(s).toMatchObject({ igst: false, cgstRate: 9, cgst: 3.6, sgstRate: 9, sgst: 3.6, igstAmount: 0, total: 47.2 })
  })
  it('other state: all IGST at the full rate', () => {
    const s = splitTax(40, 7.2, 18, false)
    expect(s).toMatchObject({ igst: true, cgst: 0, sgst: 0, igstRate: 18, igstAmount: 7.2, total: 47.2 })
  })
  it('an odd paisa goes to CGST so the two halves still add up exactly', () => {
    const s = splitTax(10.5, 1.89, 18, true) // 189 paise: 95 + 94
    expect(s.cgst).toBe(0.95)
    expect(s.sgst).toBe(0.94)
    expect(Math.round((s.cgst + s.sgst) * 100)).toBe(189)
  })
  it('the lines always add up to the amount paid, for every plan on the client sheet', () => {
    for (const [price, paid] of [[40, 47.2], [70, 82.6], [250, 295], [500, 590], [800, 944], [15, 17.7], [30, 35.4], [100, 118]] as const) {
      const s = splitTax(price, Math.round((paid - price) * 100) / 100, 18, true)
      expect(Math.round((price + s.cgst + s.sgst) * 100)).toBe(Math.round(paid * 100))
      expect(s.total).toBe(paid)
    }
  })
})

describe('rupeesInWords', () => {
  it('writes the totals on the client sheet in Indian numbering', () => {
    expect(rupeesInWords(47.2)).toBe('Rupees Forty Seven and Twenty Paise Only')
    expect(rupeesInWords(82.6)).toBe('Rupees Eighty Two and Sixty Paise Only')
    expect(rupeesInWords(295)).toBe('Rupees Two Hundred Ninety Five Only')
    expect(rupeesInWords(944)).toBe('Rupees Nine Hundred Forty Four Only')
    expect(rupeesInWords(12390)).toBe('Rupees Twelve Thousand Three Hundred Ninety Only')
    expect(rupeesInWords(123456.05)).toBe('Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Five Paise Only')
    expect(rupeesInWords(10_000_000)).toBe('Rupees One Crore Only')
  })
})

describe('invoiceDescription', () => {
  it('names the plan, its credit and its validity', () => {
    expect(invoiceDescription(5500, 365)).toBe('Ride-credit plan: platform access, ride credit of Rs 5,500, valid 365 days')
  })
})

describe('invoice download link', () => {
  const SECRET = 'a'.repeat(40)
  const now = 1_800_000_000
  it('opens for the invoice and driver it was signed for, until it expires', () => {
    const t = signInvoiceLink('12', '7', now + 300, SECRET)
    expect(verifyInvoiceLink(t, SECRET, now)).toEqual({ invoiceId: '12', driverId: '7' })
    expect(verifyInvoiceLink(t, SECRET, now + 301)).toBeNull()
  })
  it('rejects an edited id, a wrong secret and junk', () => {
    const t = signInvoiceLink('12', '7', now + 300, SECRET)
    expect(verifyInvoiceLink(t.replace('12.7', '13.7'), SECRET, now)).toBeNull()
    expect(verifyInvoiceLink(t, 'b'.repeat(40), now)).toBeNull()
    expect(verifyInvoiceLink('nope', SECRET, now)).toBeNull()
    expect(verifyInvoiceLink('', SECRET, now)).toBeNull()
  })
})
