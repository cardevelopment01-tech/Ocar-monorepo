import { describe, expect, it } from 'vitest'
import { getApiErrorMessage } from './apiError'

const axiosErr = (status: number, data: object) => ({ isAxiosError: true, response: { status, data } })

describe('getApiErrorMessage', () => {
  it('maps a known code to plain copy', () => {
    expect(getApiErrorMessage(axiosErr(403, { code: 'DRIVER_NOT_APPROVED' }))).toMatch(/under review/)
  })
  it('shows the first field problem of a rejected form', () => {
    expect(getApiErrorMessage(axiosErr(422, { code: 'VALIDATION_ERROR', error: 'Validation failed', fields: { email: ['Invalid email address'] } }))).toBe('Invalid email address')
  })
  it('surfaces the server message for any 4xx, hides 5xx detail', () => {
    expect(getApiErrorMessage(axiosErr(409, { error: 'Plate already used' }))).toBe('Plate already used')
    expect(getApiErrorMessage(axiosErr(500, { error: 'boom' }))).toMatch(/having trouble/)
  })
  it('reports no response as a connection problem; non-axios uses the fallback', () => {
    expect(getApiErrorMessage({ isAxiosError: true })).toMatch(/internet connection/)
    expect(getApiErrorMessage(new Error('x'), 'Nope')).toBe('Nope')
  })
})
