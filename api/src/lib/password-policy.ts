import crypto from 'crypto'
import { config } from '@/config'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'password-policy' })

// NIST SP 800-63B-4: favour length over character-mix rules, and screen new passwords against known-breached ones.
export const ADMIN_PASSWORD_MIN_LENGTH = 12
// bcrypt only reads the first 72 bytes; 64 characters is NIST's floor for "allow long passwords" and stays inside that.
export const ADMIN_PASSWORD_MAX_LENGTH = 64

export const WEAK_PASSWORD_MESSAGE = 'That password has appeared in a data breach, so it is not safe to use. Choose a different one.'
export const CONTEXT_PASSWORD_MESSAGE = 'Your password should not contain "ocar" or the first part of your email address. Choose a different one.'

/**
 * Has this password appeared in a known breach? Uses Have I Been Pwned's k-anonymity range API: only the first 5 characters of the
 * password's SHA-1 leave the server, never the password or the person. Fails OPEN (returns false) on any network trouble, so an outage at
 * that service can never stop an admin from activating their account.
 */
export async function isPasswordBreached(password: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase()
  const prefix = sha1.slice(0, 5)
  const suffix = sha1.slice(5)
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      // Padding makes every answer a similar size, so a network observer cannot tell which prefix was asked about.
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(2500),
    })
    if (!res.ok) return false
    const body = await res.text()
    return body.split('\n').some((line) => {
      const [hashSuffix, count] = line.trim().split(':')
      return hashSuffix === suffix && Number(count) > 0 // padded (fake) lines have a count of 0
    })
  } catch (err) {
    log.warn({ err }, 'password breach check unavailable; allowing the password')
    return false
  }
}

/** Why this new password is not acceptable, or null when it is fine. Length is enforced earlier, by the request schema. */
export async function checkNewPassword(
  password: string,
  ctx: { email: string },
  opts: { breachCheck?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const lower = password.toLowerCase()
  const emailStart = (ctx.email.split('@')[0] ?? '').toLowerCase()
  if (lower.includes('ocar') || (emailStart.length >= 4 && lower.includes(emailStart))) return CONTEXT_PASSWORD_MESSAGE

  const breachCheck = opts.breachCheck ?? config.PASSWORD_BREACH_CHECK === 'on'
  if (breachCheck && (await isPasswordBreached(password, opts.fetchImpl))) return WEAK_PASSWORD_MESSAGE
  return null
}
