import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

vi.mock('@/modules/auth/auth.service', () => ({
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  adminLogin: vi.fn(),
  verifyAdminTotp: vi.fn(),
  refreshTokens: vi.fn(),
  logout: vi.fn(),
}))
vi.mock('@/modules/auth/auth.repository', () => ({}))

import * as authService from '@/modules/auth/auth.service'
import * as controller from '@/modules/auth/auth.controller'
import { phoneTail, errorCode, logSecurityEvent } from '@/observability/security-events'

function call(body: Record<string, unknown>) {
  const log = { info: vi.fn(), warn: vi.fn() }
  const req = { body, ip: '203.0.113.9', log } as unknown as Request
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
  const next = vi.fn()
  return { req, res, next, log }
}
const tokens = { accessToken: 'a.b.c', refreshToken: 'secret-refresh' }
const apiError = (appCode: string) => Object.assign(new Error('boom'), { httpStatus: 401, appCode })

describe('auth security events', () => {
  beforeEach(() => vi.clearAllMocks())

  it('logs a successful OTP verification with the account, never the OTP or the full number', async () => {
    vi.mocked(authService.verifyOtp).mockResolvedValue({ tokens, principal: { id: 42n }, isNew: false } as never)
    const { req, res, next, log } = call({ phone: '+919876543210', otp: '123456', role: 'driver' })
    await controller.verifyOtp(req, res, next)
    expect(log.info).toHaveBeenCalledTimes(1)
    const [fields] = log.info.mock.calls[0]!
    expect(fields).toMatchObject({ event: 'auth.otp.verify', outcome: 'success', role: 'driver', actor_id: '42', phone_tail: '3210', is_new: false })
    const text = JSON.stringify(log.info.mock.calls)
    expect(text).not.toContain('123456')
    expect(text).not.toContain('9876543210')
    expect(text).not.toContain('secret-refresh')
    expect(next).not.toHaveBeenCalled()
  })

  it('logs a failed OTP verification as a warning with the API error code, then passes the error on', async () => {
    const err = apiError('INVALID_OTP')
    vi.mocked(authService.verifyOtp).mockRejectedValue(err)
    const { req, res, next, log } = call({ phone: '+919876543210', otp: '000000', role: 'user' })
    await controller.verifyOtp(req, res, next)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toMatchObject({ event: 'auth.otp.verify', outcome: 'failure', role: 'user', phone_tail: '3210', code: 'INVALID_OTP' })
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('000000')
    expect(next).toHaveBeenCalledWith(err)
  })

  it('logs OTP requests, admin logins (with and without 2FA), refreshes and logouts', async () => {
    vi.mocked(authService.requestOtp).mockResolvedValue({ otp: '111111' } as never)
    let c = call({ phone: '+919876543210', role: 'user' })
    await controller.requestOtp(c.req, c.res, c.next)
    expect(c.log.info.mock.calls[0]![0]).toMatchObject({ event: 'auth.otp.request', outcome: 'success', phone_tail: '3210' })

    vi.mocked(authService.adminLogin).mockResolvedValue({ pending: true, pendingToken: 'pt' } as never)
    c = call({ email: 'ops@ocar.in', password: 'hunter2' })
    await controller.adminLogin(c.req, c.res, c.next)
    expect(c.log.info.mock.calls[0]![0]).toMatchObject({ event: 'auth.admin.login', outcome: 'success', admin_email: 'ops@ocar.in', totp_required: true })
    expect(JSON.stringify(c.log.info.mock.calls)).not.toContain('hunter2')

    vi.mocked(authService.adminLogin).mockResolvedValue({ tokens, admin: { id: 9n } } as never)
    c = call({ email: 'ops@ocar.in', password: 'hunter2' })
    await controller.adminLogin(c.req, c.res, c.next)
    expect(c.log.info.mock.calls[0]![0]).toMatchObject({ outcome: 'success', actor_id: '9', totp_required: false })

    vi.mocked(authService.refreshTokens).mockResolvedValue({ tokens } as never)
    c = call({ refreshToken: 'secret-refresh' })
    await controller.refreshToken(c.req, c.res, c.next)
    expect(c.log.info.mock.calls[0]![0]).toMatchObject({ event: 'auth.token.refresh', outcome: 'success' })
    expect(JSON.stringify(c.log.info.mock.calls)).not.toContain('secret-refresh')

    vi.mocked(authService.logout).mockResolvedValue(undefined)
    c = call({ refreshToken: 'secret-refresh' })
    await controller.logout(c.req, c.res, c.next)
    expect(c.log.info.mock.calls[0]![0]).toMatchObject({ event: 'auth.logout', outcome: 'success' })
  })

  it('logs a failed admin login and a failed refresh (replay or expiry) as warnings', async () => {
    vi.mocked(authService.adminLogin).mockRejectedValue(apiError('INVALID_CREDENTIALS'))
    let c = call({ email: 'ops@ocar.in', password: 'wrong' })
    await controller.adminLogin(c.req, c.res, c.next)
    expect(c.log.warn.mock.calls[0]![0]).toMatchObject({ event: 'auth.admin.login', outcome: 'failure', code: 'INVALID_CREDENTIALS', admin_email: 'ops@ocar.in' })
    expect(JSON.stringify(c.log.warn.mock.calls)).not.toContain('wrong')

    vi.mocked(authService.refreshTokens).mockRejectedValue(apiError('TOKEN_REUSED'))
    c = call({ refreshToken: 'secret-refresh' })
    await controller.refreshToken(c.req, c.res, c.next)
    expect(c.log.warn.mock.calls[0]![0]).toMatchObject({ event: 'auth.token.refresh', outcome: 'failure', code: 'TOKEN_REUSED' })
  })

  it('never changes the response when logging itself fails', () => {
    const req = { log: { info: () => { throw new Error('log down') }, warn: () => { throw new Error('log down') } } } as unknown as Request
    expect(() => logSecurityEvent(req, 'auth.logout', 'success')).not.toThrow()
    expect(() => logSecurityEvent({} as Request, 'auth.logout', 'failure')).not.toThrow()
  })

  it('helpers: last 4 digits only, and the API error code never the message', () => {
    expect(phoneTail('+919876543210')).toBe('3210')
    expect(phoneTail('12')).toBeUndefined()
    expect(phoneTail(undefined)).toBeUndefined()
    expect(errorCode(apiError('OTP_EXPIRED'))).toBe('OTP_EXPIRED')
    expect(errorCode(Object.assign(new Error('x'), { code: '23505' }))).toBe('23505')
    expect(errorCode(null)).toBe('UNKNOWN')
  })
})
