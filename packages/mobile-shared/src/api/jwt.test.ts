import { describe, expect, it } from 'vitest'
import { tokenExpiresSoon } from './jwt'

function makeToken(payload: Record<string, unknown>): string {
  const base64url = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${base64url({ alg: 'HS256' })}.${base64url(payload)}.signature`
}

describe('tokenExpiresSoon', () => {
  it('returns false for a token expiring well in the future', () => {
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 })
    expect(tokenExpiresSoon(token)).toBe(false)
  })

  it('returns true for an already-expired token', () => {
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 10 })
    expect(tokenExpiresSoon(token)).toBe(true)
  })

  it('returns true when within the skew window', () => {
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 30 })
    expect(tokenExpiresSoon(token, 60)).toBe(true)
  })

  it('returns false for a malformed token instead of throwing', () => {
    expect(tokenExpiresSoon('not-a-jwt')).toBe(false)
    expect(tokenExpiresSoon('')).toBe(false)
  })
})
