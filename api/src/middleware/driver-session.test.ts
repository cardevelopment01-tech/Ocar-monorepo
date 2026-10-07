import { describe, it, expect, vi } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { get }, getJSON: vi.fn(), setWithTTL: vi.fn() }))
vi.mock('@/modules/auth/auth.repository', () => ({}))

import { isDriverSessionReplaced } from './auth.middleware'

describe('isDriverSessionReplaced', () => {
  it('rejects a token whose sid is no longer current', async () => {
    get.mockResolvedValue('new')
    expect(await isDriverSessionReplaced('1', 'old')).toBe(true)
  })
  it('accepts the current sid, legacy tokens, and a missing key', async () => {
    get.mockResolvedValue('new')
    expect(await isDriverSessionReplaced('1', 'new')).toBe(false)
    expect(await isDriverSessionReplaced('1', undefined)).toBe(false)
    get.mockResolvedValue(null)
    expect(await isDriverSessionReplaced('1', 'old')).toBe(false)
  })
})
