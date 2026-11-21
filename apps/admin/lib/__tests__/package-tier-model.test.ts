import { describe, expect, it } from 'vitest'
import type { PackageTier } from '../package-api'
import {
  checkForm, EMPTY_FORM, errorMessage, formatMultiple, formFromTier, hasErrors, inr, lowerValueIds, multiple, pricing, summarize, type TierForm,
} from '../package-tier-model'

// Value: protects=the Package Tiers page tells the admin the truth before saving: the price a driver will pay (to the paisa, the same as the
// server), which plans are a worse deal than a cheaper one, and which fields are wrong and why; fails_when=the preview shows ₹47.19 where the
// server charges ₹47.20, the client's ₹500 plan (21x, worse than the ₹250 plan's 22x) is not flagged, or a duplicate or a plan worth less than
// its price passes the form; why_new=plans carry GST, validity and a vehicle group; seam=none (pure rules); no_claim=the component or the API.

let nextId = 1
const tier = (price: number, value: number, over: Partial<PackageTier> = {}): PackageTier => ({
  id: nextId++, label: `₹${price}`, price: String(price), threshold_value: String(value), is_active: true, vehicle_group: 'cab', validity_days: 365,
  gst_percent: 18, gst_amount: '0', total_amount: '0', created_at: '', updated_at: '', ...over,
})
const SHEET = [[40, 550], [70, 1050], [250, 5500], [500, 10500], [800, 20000]] as const
const form = (over: Partial<TierForm> = {}): TierForm => ({ label: 'Starter', price: '40', thresholdValue: '550', vehicleGroup: 'cab', validityDays: '365', ...over })

describe('pricing', () => {
  it('adds GST on top to the paisa, the way the server does', () => {
    expect(pricing(40, 18)).toEqual({ price: 40, gst: 7.2, total: 47.2 })
    expect(pricing(70, 18)).toEqual({ price: 70, gst: 12.6, total: 82.6 })
    expect(pricing(250, 18)).toEqual({ price: 250, gst: 45, total: 295 })
    expect(pricing(15, 18)).toEqual({ price: 15, gst: 2.7, total: 17.7 })
    expect(pricing(40, 0)).toEqual({ price: 40, gst: 0, total: 40 })
  })
})

describe('formatting', () => {
  it('writes rupees with Indian grouping, paise only when there are some', () => {
    expect(inr(5500)).toBe('₹5,500')
    expect(inr('20000.00')).toBe('₹20,000')
    expect(inr(47.2)).toBe('₹47.20')
    expect(inr(295, { paise: true })).toBe('₹295.00')
    expect(inr(123456)).toBe('₹1,23,456')
    expect(inr('abc')).toBe('₹—')
  })
  it('shows the value multiple with one decimal only when it is not whole', () => {
    expect(formatMultiple(multiple(250, 5500))).toBe('22×')
    expect(formatMultiple(multiple(40, 550))).toBe('13.8×')
  })
})

describe('checkForm', () => {
  const saved = SHEET.map(([p, v]) => tier(p, v))
  it('accepts a good plan', () => {
    const c = checkForm(form({ price: '30', thresholdValue: '1000' }), saved, null)
    expect(hasErrors(c)).toBe(false)
  })
  it('says what is wrong with each field', () => {
    const c = checkForm(form({ label: ' ', price: '', thresholdValue: '0', validityDays: '0' }), [], null)
    expect(c.errors.label).toMatch(/name/)
    expect(c.errors.price).toMatch(/above zero/)
    expect(c.errors.thresholdValue).toMatch(/above zero/)
    expect(c.errors.validityDays).toMatch(/1 to 3650/)
  })
  it('refuses a ride value below the price, and three decimals', () => {
    expect(checkForm(form({ price: '600', thresholdValue: '550' }), [], null).errors.thresholdValue).toMatch(/at least the price/)
    expect(checkForm(form({ price: '40.123' }), [], null).errors.price).toMatch(/two decimal/)
    expect(checkForm(form({ validityDays: '1.5' }), [], null).errors.validityDays).toBeDefined()
  })
  it('refuses a second active plan identical to one that exists, but not the plan being edited, nor a plan for the other drivers', () => {
    expect(checkForm(form(), saved, null).errors.form).toMatch(/already exists/)
    expect(checkForm(form(), saved, saved[0]!.id).errors.form).toBeUndefined()
    expect(checkForm(form({ vehicleGroup: 'auto' }), saved, null).errors.form).toBeUndefined()
    const inactive = [tier(40, 550, { is_active: false })]
    expect(checkForm(form(), inactive, null).errors.form).toBeUndefined()
  })
  it('warns, without blocking, when a bigger plan gives less per rupee than a cheaper one', () => {
    const c = checkForm(form({ label: 'Big', price: '500', thresholdValue: '10500' }), saved.slice(0, 3), null)
    expect(hasErrors(c)).toBe(false)
    expect(c.warnings.join(' ')).toMatch(/less than the ₹250 plan/)
  })
  it('warns when there is no bonus at all', () => {
    expect(checkForm(form({ price: '100', thresholdValue: '100' }), [], null).warnings.join(' ')).toMatch(/No bonus/)
  })
  it('starts empty on the first group with a year of validity', () => {
    expect(EMPTY_FORM).toMatchObject({ vehicleGroup: 'cab', validityDays: '365' })
  })
  it('turns a saved plan back into form text', () => {
    expect(formFromTier(tier(40, 550, { price: '40.00', threshold_value: '550.00' }))).toMatchObject({ price: '40', thresholdValue: '550', validityDays: '365' })
  })
})

describe('lowerValueIds', () => {
  it('flags the client sheet’s ₹500 plan (21x) as worse than the ₹250 plan (22x), and nothing else', () => {
    const tiers = SHEET.map(([p, v]) => tier(p, v))
    expect(lowerValueIds(tiers)).toEqual(new Set([tiers[3]!.id]))
  })
  it('keeps the two vehicle groups apart and ignores plans that are switched off', () => {
    const cab = tier(250, 5500), auto = tier(100, 1500, { vehicle_group: 'auto' }), off = tier(500, 9000, { is_active: false })
    expect(lowerValueIds([cab, auto, off]).size).toBe(0)
  })
})

describe('summarize', () => {
  it('counts plans per group and reads the GST rate', () => {
    const s = summarize([tier(40, 550), tier(70, 1050, { is_active: false }), tier(15, 500, { vehicle_group: 'auto' })])
    expect(s).toMatchObject({ active: 2, total: 3, gstPercent: 18, byGroup: { cab: { total: 2, active: 1 }, auto: { total: 1, active: 1 } } })
    expect(summarize([]).gstPercent).toBeNull()
  })
  it('reports the validity most live plans share, ignoring plans that are switched off', () => {
    const s = summarize([tier(40, 550, { validity_days: 365 }), tier(70, 1050, { validity_days: 365 }), tier(250, 5500, { validity_days: 90 }), tier(15, 500, { validity_days: 30, is_active: false })])
    expect(s.usualValidityDays).toBe(365)
    expect(summarize([tier(40, 550, { validity_days: 30 }), tier(70, 1050, { validity_days: 90 })]).usualValidityDays).toBe(90) // tie: the longer
    expect(summarize([]).usualValidityDays).toBeNull()
  })
})

describe('errorMessage', () => {
  it('uses the server’s own words when it sent some', () => {
    expect(errorMessage({ response: { data: { error: 'The ride value must be at least the price' } } }, 'fallback')).toBe('The ride value must be at least the price')
  })
  it('falls back to a plain sentence', () => {
    expect(errorMessage(new Error('Network Error'), 'Could not save.')).toBe('Could not save.')
    expect(errorMessage({ response: { data: { error: '  ' } } }, 'Could not save.')).toBe('Could not save.')
  })
})
