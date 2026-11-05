import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

const h = vi.hoisted(() => ({
  cfg: {
    DB_AUTH_MODE: 'secrets-manager', DB_HOST: 'h', DB_PORT: 5432, DB_NAME: 'n', DB_USER: 'u', DB_SECRET_ARN: 'arn',
    DATABASE_URL: '', DATABASE_POOL_MIN: 0, DATABASE_POOL_MAX: 1, WORKER_POOL_MAX: 1, ANALYTICS_POOL_MAX: 1, AWS_REGION: 'ap-south-1',
  },
  poolQuery: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('@/config', () => ({ config: h.cfg }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/db-secret', () => ({ getDbPassword: vi.fn(), invalidateDbPassword: h.invalidate }))
vi.mock('@/observability/metrics', () => ({ pgQueryErrorsTotal: { inc: vi.fn() } }))
vi.mock('pg', () => ({
  types: { setTypeParser: vi.fn() },
  Pool: class { query = h.poolQuery; connect = vi.fn() },
}))

let query: typeof import('@/db/client').query
beforeAll(async () => { query = (await import('@/db/client')).query })

const badPassword = Object.assign(new Error('password authentication failed'), { code: '28P01' })

describe('query() and a rotated database password', () => {
  beforeEach(() => { h.poolQuery.mockReset(); h.invalidate.mockReset(); h.cfg.DB_AUTH_MODE = 'secrets-manager' })

  it('forgets the cached password and retries once on 28P01', async () => {
    h.poolQuery.mockRejectedValueOnce(badPassword).mockResolvedValueOnce({ rows: [{ ok: 1 }] })
    expect(await query('select 1')).toEqual([{ ok: 1 }])
    expect(h.invalidate).toHaveBeenCalledTimes(1)
    expect(h.poolQuery).toHaveBeenCalledTimes(2)
  })

  it('gives up after one retry', async () => {
    h.poolQuery.mockRejectedValue(badPassword)
    await expect(query('select 1')).rejects.toThrow('password authentication failed')
    expect(h.poolQuery).toHaveBeenCalledTimes(2)
  })

  it('does not retry other errors', async () => {
    h.poolQuery.mockRejectedValue(Object.assign(new Error('boom'), { code: '23505' }))
    await expect(query('select 1')).rejects.toThrow('boom')
    expect(h.poolQuery).toHaveBeenCalledTimes(1)
    expect(h.invalidate).not.toHaveBeenCalled()
  })

  it('does not retry in password mode, where re-reading a secret cannot help', async () => {
    h.cfg.DB_AUTH_MODE = 'password'
    h.poolQuery.mockRejectedValue(badPassword)
    await expect(query('select 1')).rejects.toThrow('password authentication failed')
    expect(h.poolQuery).toHaveBeenCalledTimes(1)
  })
})
