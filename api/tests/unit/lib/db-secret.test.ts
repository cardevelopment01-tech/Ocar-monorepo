import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const send = vi.hoisted(() => vi.fn())
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class { send = send },
  GetSecretValueCommand: class { constructor(public input: unknown) {} },
}))

import { getDbPassword, invalidateDbPassword, CACHE_TTL_MS } from '@/lib/db-secret'

const secret = (password: string) => ({ SecretString: JSON.stringify({ username: 'ocar_admin', password }) })

describe('getDbPassword', () => {
  beforeEach(() => { vi.useFakeTimers(); send.mockReset(); invalidateDbPassword() })
  afterEach(() => vi.useRealTimers())

  it('reads the secret once and serves it from cache inside the TTL', async () => {
    send.mockResolvedValue(secret('p1'))
    expect(await getDbPassword('arn')).toBe('p1')
    expect(await getDbPassword('arn')).toBe('p1')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('picks up a rotated password once the TTL has passed', async () => {
    send.mockResolvedValueOnce(secret('p1')).mockResolvedValueOnce(secret('p2'))
    expect(await getDbPassword('arn')).toBe('p1')
    vi.advanceTimersByTime(CACHE_TTL_MS + 1)
    expect(await getDbPassword('arn')).toBe('p2')
  })

  it('picks up a rotated password immediately after invalidateDbPassword', async () => {
    send.mockResolvedValueOnce(secret('p1')).mockResolvedValueOnce(secret('p2'))
    await getDbPassword('arn')
    invalidateDbPassword()
    expect(await getDbPassword('arn')).toBe('p2')
  })

  it('keeps serving the last known password when Secrets Manager errors', async () => {
    send.mockResolvedValueOnce(secret('p1')).mockRejectedValueOnce(new Error('throttled'))
    await getDbPassword('arn')
    vi.advanceTimersByTime(CACHE_TTL_MS + 1)
    expect(await getDbPassword('arn')).toBe('p1')
  })

  it('throws when there is nothing cached and the read fails, or the secret has no password', async () => {
    send.mockRejectedValueOnce(new Error('denied'))
    await expect(getDbPassword('arn')).rejects.toThrow('denied')
    send.mockResolvedValueOnce({ SecretString: '{}' })
    await expect(getDbPassword('arn')).rejects.toThrow('no password')
  })
})
