import { describe, it, expect, vi } from 'vitest'

const { findUserById } = vi.hoisted(() => ({ findUserById: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn() }, getJSON: vi.fn().mockResolvedValue(null), setWithTTL: vi.fn() }))
vi.mock('@/modules/auth/auth.repository', () => ({ findUserById, findDriverById: vi.fn(), findAdminById: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

import { authenticate } from './auth.middleware'
import { signAccessToken } from '@/lib/jwt'
import { PrincipalRole } from '@/constants/enums'

function run(token: string) {
  const res: Record<string, unknown> = {}
  const headers: Record<string, string> = {}
  res['set'] = (k: string, v: string) => { headers[k] = v; return res }
  res['status'] = (s: number) => { res['code'] = s; return res }
  res['json'] = (b: unknown) => { res['body'] = b; return res }
  const next = vi.fn()
  const done = authenticate()({ headers: { authorization: `Bearer ${token}` } } as never, res as never, next) as unknown as Promise<void>
  return done.then(() => ({ res, headers, next }))
}

describe('authenticate() when the database is down', () => {
  const token = signAccessToken({ sub: '1', code: 'USR1', role: PrincipalRole.USER })

  it('answers 503 + Retry-After, not 401, so clients keep the session', async () => {
    findUserById.mockRejectedValue(Object.assign(new Error('x'), { code: 'ECONNRESET' }))
    const { res, headers } = await run(token)
    expect(res['code']).toBe(503)
    expect(headers['Retry-After']).toBe('2')
    expect((res['body'] as { code: string }).code).toBe('SERVICE_UNAVAILABLE')
  })
  it('still answers 401 for a bad token', async () => {
    const { res } = await run('not-a-jwt')
    expect(res['code']).toBe(401)
  })
})
