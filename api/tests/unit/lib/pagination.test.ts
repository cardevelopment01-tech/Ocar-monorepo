import { describe, it, expect } from 'vitest'
import { encodeCursor, decodeCursor } from '@/lib/pagination'

describe('cursor pagination', () => {
  it('encodes and decodes cursor round-trip', () => {
    const id = BigInt(12345)
    const date = new Date('2026-01-01T00:00:00Z')
    const cursor = encodeCursor(id, date)
    const decoded = decodeCursor(cursor)
    expect(decoded).not.toBeNull()
    expect(decoded?.id).toBe(id)
    expect(decoded?.createdAt.toISOString()).toBe(date.toISOString())
  })

  it('returns null for malformed cursor', () => {
    expect(decodeCursor('not-valid-base64!!')).toBeNull()
  })
})
