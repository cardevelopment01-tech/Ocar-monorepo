// One structured log line per authentication outcome, so a login attack or a stolen-token replay leaves a trail that names the
// request (and, through the request logger, the client address). Written through req.log, so it carries the request id and
// trace id. Nothing secret goes in: no OTP, password, token or full phone number (the last 4 digits identify a number well
// enough to spot repeated attempts against it without writing the number itself).
import type { Request } from 'express'

export type AuthEvent =
  | 'auth.otp.request'
  | 'auth.otp.verify'
  | 'auth.admin.login'
  | 'auth.admin.totp'
  | 'auth.token.refresh'
  | 'auth.logout'

// `| undefined` because exactOptionalPropertyTypes is on and callers pass possibly-missing values; JSON drops them.
export interface AuthEventFields {
  role?: string | undefined
  actor_id?: string | undefined
  phone_tail?: string | undefined
  admin_email?: string | undefined
  is_new?: boolean | undefined
  totp_required?: boolean | undefined
  code?: string | undefined
}

export const phoneTail = (phone: unknown): string | undefined =>
  typeof phone === 'string' && phone.length >= 4 ? phone.slice(-4) : undefined

// The API's own error code (e.g. INVALID_OTP, OTP_EXPIRED), never the message text.
export function errorCode(err: unknown): string {
  const e = err as { appCode?: unknown; code?: unknown } | null | undefined
  if (typeof e?.appCode === 'string') return e.appCode
  if (typeof e?.code === 'string') return e.code
  return 'UNKNOWN'
}

export function logSecurityEvent(req: Request, event: AuthEvent, outcome: 'success' | 'failure', fields: AuthEventFields = {}): void {
  try {
    const payload = { event, outcome, ...fields }
    // failures are the lines somebody should look at; successes are the evidence trail
    if (outcome === 'failure') req.log?.warn(payload, event)
    else req.log?.info(payload, event)
  } catch {
    // logging must never change what the caller sees
  }
}
