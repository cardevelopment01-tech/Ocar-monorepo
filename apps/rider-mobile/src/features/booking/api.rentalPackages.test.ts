import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn()
vi.mock('@/services/api', () => ({ api: { get: (...a: unknown[]) => get(...a) } }))
vi.mock('@ocar/mobile-shared', async () => {
  const camel = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(camel)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), camel(x)]))
    : v
  return { camelizeKeys: camel, getApiErrorMessage: () => '' }
})

import { fetchAllRentalPackages } from './api'

beforeEach(() => get.mockReset())

describe('fetchAllRentalPackages', () => {
  it('makes one call and groups the rows by category', async () => {
    get.mockResolvedValueOnce({ data: [{ id: 1, category_id: 7 }, { id: 2, category_id: 7 }, { id: 3, category_id: 1 }] })
    const out = await fetchAllRentalPackages([7, 1, 2], 25)
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/api/v1/pricing/rental-packages', { params: { city_id: 25 } })
    expect(out[7]!.map((p) => p.id)).toEqual([1, 2])
    expect(out[1]!.map((p) => p.id)).toEqual([3])
    expect(out[2]).toEqual([]) // a category with no packages still gets an empty list
  })

  it('sends no city_id when there is no city', async () => {
    get.mockResolvedValueOnce({ data: [] })
    await fetchAllRentalPackages([1], null)
    expect(get).toHaveBeenCalledWith('/api/v1/pricing/rental-packages', { params: {} })
  })

  it('falls back to one call per category when the one-call route fails (older server)', async () => {
    get.mockRejectedValueOnce(new Error('404'))
    get.mockResolvedValueOnce({ data: [{ id: 5, category_id: 1 }] })
    get.mockRejectedValueOnce(new Error('boom'))
    const out = await fetchAllRentalPackages([1, 2], 25)
    expect(get).toHaveBeenCalledTimes(3)
    expect(get).toHaveBeenCalledWith('/api/v1/pricing/rental-packages/1', { params: { city_id: 25 } })
    expect(out[1]!.map((p) => p.id)).toEqual([5])
    expect(out[2]).toBeUndefined() // a failed category is left out, like before
  })
})
