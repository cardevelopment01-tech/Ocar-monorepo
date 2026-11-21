import { describe, it, expect, vi } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))

import { polygonText, checkRates, checkReason, MAX_TOLL } from '@/modules/admin/airport-zones'

const SQUARE = { type: 'Polygon', coordinates: [[[85.808, 20.235], [85.828, 20.235], [85.828, 20.254], [85.808, 20.254], [85.808, 20.235]]] }

describe('airport zone polygon input', () => {
  it('accepts a GeoJSON polygon, as an object or as pasted text', () => {
    expect(JSON.parse(polygonText(SQUARE))).toEqual(SQUARE)
    expect(JSON.parse(polygonText(JSON.stringify(SQUARE)))).toEqual(SQUARE)
  })

  it.each([
    ['not JSON', 'hello'],
    ['a point', { type: 'Point', coordinates: [85.8, 20.2] }],
    ['a ring with too few corners', { type: 'Polygon', coordinates: [[[85.8, 20.2], [85.9, 20.2], [85.8, 20.2]]] }],
    ['a corner outside the world', { type: 'Polygon', coordinates: [[[85.8, 20.2], [85.9, 200], [85.9, 20.3], [85.8, 20.2]]] }],
    ['a corner that is not numbers', { type: 'Polygon', coordinates: [[[85.8, 20.2], ['x', 20.2], [85.9, 20.3], [85.8, 20.2]]] }],
    ['nothing', null],
  ])('rejects %s', (_n, v) => {
    expect(() => polygonText(v)).toThrow(expect.objectContaining({ httpStatus: 422 }))
  })
})

describe('airport toll rates input', () => {
  it('accepts a toll per vehicle type, including 0 (that type pays nothing here)', () => {
    expect(checkRates([{ category_id: 1, amount: 40 }, { category_id: 2, amount: 0 }])).toEqual([{ category_id: 1, amount: 40 }, { category_id: 2, amount: 0 }])
  })

  it.each([
    ['a negative toll', [{ category_id: 1, amount: -1 }]],
    ['an oversized toll', [{ category_id: 1, amount: MAX_TOLL + 1 }]],
    ['a vehicle type twice', [{ category_id: 1, amount: 40 }, { category_id: 1, amount: 50 }]],
    ['a missing vehicle type', [{ amount: 40 }]],
    ['a toll that is not a number', [{ category_id: 1, amount: 'abc' }]],
    ['something that is not a list', 'x'],
  ])('rejects %s', (_n, v) => {
    expect(() => checkRates(v)).toThrow(expect.objectContaining({ httpStatus: 422 }))
  })
})

describe('airport zone change reason', () => {
  it('is required, trimmed and bounded', () => {
    expect(checkReason('  Airport gate moved ')).toBe('Airport gate moved')
    for (const v of [undefined, '', '  ', 'ab', 'x'.repeat(301), 5]) {
      expect(() => checkReason(v)).toThrow(expect.objectContaining({ httpStatus: 422 }))
    }
  })
})
