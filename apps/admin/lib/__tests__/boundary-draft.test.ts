// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { saveDraft, loadDraft, clearDraft, DRAFT_MAX_AGE_MS, draftKey } from '../boundary-draft'
import type { CityBoundaryGeoJson } from '../boundary-api'

const POLY: CityBoundaryGeoJson = {
  type: 'Polygon',
  coordinates: [[[85.1, 20.1], [85.2, 20.1], [85.2, 20.2], [85.1, 20.1]]],
}

beforeEach(() => localStorage.clear())
afterEach(() => { vi.useRealTimers() })

describe('boundary-draft', () => {
  it('round-trips a draft with its baseline version', () => {
    expect(saveDraft(7, '2026-09-25T10:00:00.000Z', POLY)).toBe(true)
    const d = loadDraft(7)
    expect(d?.polygon).toEqual(POLY)
    expect(d?.baseUpdatedAt).toBe('2026-09-25T10:00:00.000Z')
    expect(typeof d?.savedAt).toBe('number')
  })

  it('keeps drafts per city', () => {
    saveDraft(7, 'a', POLY)
    expect(loadDraft(8)).toBeNull()
  })

  it('clearDraft removes it', () => {
    saveDraft(7, 'a', POLY)
    clearDraft(7)
    expect(loadDraft(7)).toBeNull()
  })

  it('drops a draft older than the max age', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    saveDraft(7, 'a', POLY)
    vi.setSystemTime(Date.now() + DRAFT_MAX_AGE_MS + 1000)
    expect(loadDraft(7)).toBeNull()
    expect(localStorage.getItem(draftKey(7))).toBeNull() // and cleans up after itself
  })

  it.each([
    ['not json', 'nope'],
    ['unknown version', JSON.stringify({ v: 99, baseUpdatedAt: 'a', savedAt: Date.now(), polygon: POLY })],
    ['bad polygon', JSON.stringify({ v: 1, baseUpdatedAt: 'a', savedAt: Date.now(), polygon: { type: 'Polygon', coordinates: [[[1, 2]]] } })],
    ['missing fields', JSON.stringify({ v: 1 })],
  ])('ignores and removes a corrupt record (%s)', (_l, raw) => {
    localStorage.setItem(draftKey(7), raw)
    expect(loadDraft(7)).toBeNull()
    expect(localStorage.getItem(draftKey(7))).toBeNull()
  })

  it('refuses to store an oversized shape', () => {
    const ring = Array.from({ length: 30_000 }, (_, i) => [85 + i * 1e-6, 20 + i * 1e-6] as [number, number])
    expect(saveDraft(7, 'a', { type: 'Polygon', coordinates: [ring] })).toBe(false)
    expect(loadDraft(7)).toBeNull()
  })

  it('reports failure (does not throw) when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(saveDraft(7, 'a', POLY)).toBe(false)
    spy.mockRestore()
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(loadDraft(7)).toBeNull()
    get.mockRestore()
  })
})
