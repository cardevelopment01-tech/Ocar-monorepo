import { Request, Response, NextFunction } from 'express'
import * as authService from './auth.service'
import * as repo from './auth.repository'
import { logSecurityEvent, phoneTail, errorCode } from '@/observability/security-events'
import { recordAuditLog } from '@/lib/audit-log'

// Admin sign-ins are security events the audit page must show: who, from where, and every refused attempt.
async function auditAdminAuth(
  req: Request, action: string, outcome: 'success' | 'failure', adminId: bigint | null,
  extra: Record<string, unknown> = {}, lookupEmail?: string,
): Promise<void> {
  try {
    let id = adminId
    if (id === null && lookupEmail) {
      const row = await repo.findAdminByEmail(lookupEmail)
      if (row) id = BigInt(row.id)
    }
    await recordAuditLog({
      adminId: id, action, targetTable: 'admins', targetId: id, outcome, source: 'auth',
      afterState: extra, ipAddress: req.ip ?? null, requestId: req.requestId,
      userAgent: (req.headers?.['user-agent'] as string | undefined) ?? null,
    })
  } catch {
    // A sign-in must never fail because its audit row could not be written.
  }
}

// Every handler below writes one security-event line per outcome (observability/security-events.ts). Failures are
// logged before next(err) so the error response and the event share a request id.

export async function requestOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { phone, role, purpose = 'login' } = req.body as {
      phone: string
      role: 'user' | 'driver'
      purpose: 'login'
    }
    const result = await authService.requestOtp(phone, role, purpose, (req.body as { autoRead?: boolean }).autoRead === true)
    // Return OTP in non-production so tests and development work without SMS.
    // DEMO_MODE must never override this in a real production deployment —
    // it only widens the leak within non-production environments (e.g. a
    // staging/demo VPS that also wants demo-force endpoints unlocked).
    const body: Record<string, unknown> = { message: 'OTP sent' }
    const isProduction = process.env['NODE_ENV'] === 'production'
    if (!isProduction) body['otp'] = result.otp
    logSecurityEvent(req, 'auth.otp.request', 'success', { role, phone_tail: phoneTail(phone) })
    res.status(200).json(body)
  } catch (err) {
    const b = (req.body ?? {}) as { phone?: unknown; role?: string }
    logSecurityEvent(req, 'auth.otp.request', 'failure', { role: b.role, phone_tail: phoneTail(b.phone), code: errorCode(err) })
    next(err)
  }
}

export async function verifyOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { phone, otp, role, purpose = 'login' } = req.body as {
      phone: string
      otp: string
      role: 'user' | 'driver'
      purpose: 'login'
    }
    const result = await authService.verifyOtp(phone, otp, role, purpose)
    logSecurityEvent(req, 'auth.otp.verify', 'success', { role, actor_id: String(result.principal.id), phone_tail: phoneTail(phone), is_new: result.isNew })
    res.status(result.isNew ? 201 : 200).json(result)
  } catch (err) {
    const b = (req.body ?? {}) as { phone?: unknown; role?: string }
    logSecurityEvent(req, 'auth.otp.verify', 'failure', { role: b.role, phone_tail: phoneTail(b.phone), code: errorCode(err) })
    next(err)
  }
}

export async function adminLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string }
    const result = await authService.adminLogin(email, password, req.ip ?? null)
    const pending = 'pending' in result
    logSecurityEvent(req, 'auth.admin.login', 'success', {
      role: 'admin',
      ...(pending ? {} : { actor_id: String((result as { admin: { id: unknown } }).admin.id) }),
      admin_email: email,
      totp_required: pending,
    })
    const id = pending ? null : BigInt((result as { admin: { id: string | number | bigint } }).admin.id)
    await auditAdminAuth(req, 'auth.admin.login', 'success', id, { email, totp_required: pending }, pending ? email : undefined)
    res.status(200).json(result)
  } catch (err) {
    const email = (req.body as { email?: unknown } | undefined)?.email
    logSecurityEvent(req, 'auth.admin.login', 'failure', { role: 'admin', admin_email: typeof email === 'string' ? email : undefined, code: errorCode(err) })
    await auditAdminAuth(req, 'auth.admin.login', 'failure', null, { email: typeof email === 'string' ? email.slice(0, 200) : null, code: errorCode(err) }, typeof email === 'string' ? email : undefined)
    next(err)
  }
}

export async function adminTotpVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { pendingToken, code } = req.body as { pendingToken: string; code: string }
    const result = await authService.verifyAdminTotp(pendingToken, code, req.ip ?? null)
    logSecurityEvent(req, 'auth.admin.totp', 'success', { role: 'admin', actor_id: String(result.admin.id) })
    await auditAdminAuth(req, 'auth.admin.totp', 'success', BigInt(result.admin.id))
    res.status(200).json(result)
  } catch (err) {
    logSecurityEvent(req, 'auth.admin.totp', 'failure', { role: 'admin', code: errorCode(err) })
    await auditAdminAuth(req, 'auth.admin.totp', 'failure', null, { code: errorCode(err) })
    next(err)
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken: token } = req.body as { refreshToken: string }
    const result = await authService.refreshTokens(token)
    logSecurityEvent(req, 'auth.token.refresh', 'success')
    res.status(200).json(result)
  } catch (err) {
    logSecurityEvent(req, 'auth.token.refresh', 'failure', { code: errorCode(err) })
    next(err)
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken: token } = req.body as { refreshToken: string }
    await authService.logout(token)
    logSecurityEvent(req, 'auth.logout', 'success')
    res.status(200).json({ message: 'Logged out successfully' })
  } catch (err) {
    logSecurityEvent(req, 'auth.logout', 'failure', { code: errorCode(err) })
    next(err)
  }
}


// Returns the authenticated principal's own profile.
// Protected by authenticate() middleware — set in routes.
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user) {
      const user = await repo.findUserById(req.user.id)
      res.status(200).json({ principal: user, role: 'user' })
    } else if (req.driver) {
      const driver = await repo.findDriverById(req.driver.id)
      res.status(200).json({ principal: driver, role: 'driver' })
    } else if (req.admin) {
      const admin = await repo.findAdminById(req.admin.id)
      res.status(200).json({ principal: admin, role: 'admin' })
    } else {
      res.status(401).json({ error: 'Authentication required', code: 'AUTH_UNAUTHORIZED' })
    }
  } catch (err) {
    next(err)
  }
}
