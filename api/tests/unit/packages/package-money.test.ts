import { describe, it, expect } from 'vitest'
import { allocateFare, lotExpiry, packagePricing, vehicleGroupOf } from '@/modules/packages/package-money'

// The client's plan sheet (19 Nov 2026): GST at 18% is added on top of the price, the driver pays the total and gets the full ride value.
describe('packagePricing (GST added on top of the price)', () => {
  it.each([
    // cab plans
    [40, 7.2, 47.2], [70, 12.6, 82.6], [250, 45, 295], [500, 90, 590], [800, 144, 944],
    // auto plans
    [15, 2.7, 17.7], [30, 5.4, 35.4], [100, 18, 118],
  ])('price %s -> GST %s -> charged %s', (price, gst, total) => {
    expect(packagePricing(price, 18)).toEqual({ price, gstPercent: 18, gstAmount: gst, total })
  })

  it('rounds to the paisa and handles 0% (GST switched off)', () => {
    expect(packagePricing(33.33, 18)).toMatchObject({ gstAmount: 6, total: 39.33 })
    expect(packagePricing(40, 0)).toMatchObject({ gstAmount: 0, total: 40 })
  })
})

describe('allocateFare (a fare uses the lot that expires first)', () => {
  const lots = [{ id: 'a', remaining: 100 }, { id: 'b', remaining: 550 }]
  it('takes from the first lot, then the next', () => {
    expect(allocateFare(lots, 60)).toEqual({ takes: [{ id: 'a', take: 60 }], uncovered: 0 })
    expect(allocateFare(lots, 250)).toEqual({ takes: [{ id: 'a', take: 100 }, { id: 'b', take: 150 }], uncovered: 0 })
  })
  it('reports what the lots cannot cover (the balance still goes down, possibly below zero, as it always did)', () => {
    expect(allocateFare(lots, 700)).toEqual({ takes: [{ id: 'a', take: 100 }, { id: 'b', take: 550 }], uncovered: 50 })
    expect(allocateFare([], 40)).toEqual({ takes: [], uncovered: 40 })
  })
  it('skips empty lots and ignores a zero fare', () => {
    expect(allocateFare([{ id: 'x', remaining: 0 }, { id: 'y', remaining: 30 }], 20)).toEqual({ takes: [{ id: 'y', take: 20 }], uncovered: 0 })
    expect(allocateFare(lots, 0)).toEqual({ takes: [], uncovered: 0 })
  })
  it('does not drift on paise', () => {
    expect(allocateFare([{ id: 'a', remaining: 0.1 }, { id: 'b', remaining: 0.2 }], 0.3)).toEqual({ takes: [{ id: 'a', take: 0.1 }, { id: 'b', take: 0.2 }], uncovered: 0 })
  })
})

describe('lotExpiry and vehicleGroupOf', () => {
  it('a purchase lasts the plan\'s days', () => {
    expect(lotExpiry(new Date('2026-11-21T10:00:00.000Z'), 365).toISOString()).toBe('2027-11-21T10:00:00.000Z')
    expect(lotExpiry(new Date('2026-11-21T10:00:00.000Z'), 30).toISOString()).toBe('2026-12-21T10:00:00.000Z')
  })
  it('autos have their own plans (either slug); every car type shares the cab plans; no vehicle defaults to cab', () => {
    expect(vehicleGroupOf('auto')).toBe('auto')
    expect(vehicleGroupOf('auto_rickshaw')).toBe('auto')
    for (const slug of ['hatchback', 'sedan', 'suv', 'luxury', 'van']) expect(vehicleGroupOf(slug)).toBe('cab')
    expect(vehicleGroupOf(null)).toBe('cab')
    expect(vehicleGroupOf(undefined)).toBe('cab')
  })
})
