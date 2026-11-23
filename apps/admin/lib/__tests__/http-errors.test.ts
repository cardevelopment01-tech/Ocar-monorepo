import { describe, it, expect } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { extractErrorMessage, extractErrorCode } from '../http-errors'

function axiosFailure(data: unknown, status = 422): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status, statusText: '', headers: {}, config: {}, data,
  } as unknown as AxiosResponse)
}

describe('extractErrorMessage', () => {
  it("returns the server's message from an axios error", () => {
    expect(extractErrorMessage(axiosFailure({ error: 'Self-intersection', code: 'VALIDATION_ERROR' }), 'fallback')).toBe('Self-intersection')
  })

  it('a 429 that carries its own message is shown as written; the generic throttle (or a 429 with no message) gets the standard wording', () => {
    expect(extractErrorMessage(axiosFailure({ error: 'Wait 42 seconds before resending', code: 'ADMIN_INVITE_RESEND_TOO_SOON' }, 429), 'fallback')).toBe('Wait 42 seconds before resending')
    expect(extractErrorMessage(axiosFailure({ error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' }, 429), 'fallback')).toBe('Too many attempts. Wait a moment and try again.')
    expect(extractErrorMessage(axiosFailure({}, 429), 'fallback')).toBe('Too many attempts. Wait a moment and try again.')
  })

  it('falls back when the response has no error field', () => {
    expect(extractErrorMessage(axiosFailure({}), 'fallback')).toBe('fallback')
  })

  it('says the server is unreachable on a network error with no response', () => {
    expect(extractErrorMessage(new AxiosError('Network Error'), 'fallback')).toMatch(/Can't reach the server/)
  })

  it.each([[new Error('boom')], ['a string'], [null], [undefined], [{ response: { data: { error: 'spoofed' } } }]])(
    'falls back for a non-axios throw (%#) — duck-typed look-alikes are not trusted',
    (thrown) => {
      expect(extractErrorMessage(thrown, 'fallback')).toBe('fallback')
    },
  )
})

describe('extractErrorCode', () => {
  it('returns the app error code', () => {
    expect(extractErrorCode(axiosFailure({ error: 'x', code: 'BOUNDARY_CHANGED' }, 409))).toBe('BOUNDARY_CHANGED')
  })

  it('is undefined when absent or not an axios error', () => {
    expect(extractErrorCode(axiosFailure({ error: 'x' }))).toBeUndefined()
    expect(extractErrorCode(new Error('boom'))).toBeUndefined()
    expect(extractErrorCode(undefined)).toBeUndefined()
  })
})
