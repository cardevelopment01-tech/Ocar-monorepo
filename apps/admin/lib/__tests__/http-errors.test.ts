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

  it('falls back when the response has no error field', () => {
    expect(extractErrorMessage(axiosFailure({}), 'fallback')).toBe('fallback')
  })

  it('falls back on a network error with no response', () => {
    expect(extractErrorMessage(new AxiosError('Network Error'), 'fallback')).toBe('fallback')
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
