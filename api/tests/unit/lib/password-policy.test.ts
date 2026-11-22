import { describe, it, expect, vi } from 'vitest'
import {
  checkNewPassword, isPasswordBreached, CONTEXT_PASSWORD_MESSAGE, WEAK_PASSWORD_MESSAGE,
} from '@/lib/password-policy'

// Value: protects=a new admin password is refused when it is a known-breached one or contains the company name or the person's own email
// start, only a 5-character hash prefix ever leaves the server, and an outage at the breach service can never stop an activation;
// fails_when=the whole hash (or the password) is sent out, a breached password gets through, a network failure blocks the admin, padded
// fake lines count as hits, or the check runs when switched off; why_new=admin passwords only had to be 8 characters; seam=fetch is replaced;
// no_claim=the real breach service.

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = '5BAA6'
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'
const answer = (body: string, ok = true) => vi.fn(async () => ({ ok, text: async () => body }) as unknown as Response) as unknown as typeof fetch & ReturnType<typeof vi.fn>

describe('isPasswordBreached', () => {
  it('asks the range API with only the first 5 characters of the SHA-1, asks for padding, and finds the password in the answer', async () => {
    const f = answer(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:10434004\r\n011053FD0102E94D6AE2F8B83D76FAF94F6:1`)
    expect(await isPasswordBreached('password', f)).toBe(true)
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`)
    expect(url).not.toContain(SUFFIX) // the rest of the hash never leaves
    expect((init.headers as Record<string, string>)['Add-Padding']).toBe('true')
  })

  it('a password that is not in the answer is fine, and padded fake lines (count 0) are not hits', async () => {
    expect(await isPasswordBreached('password', answer('0018A45C4D1DEF81644B54AB7F969B88D65:2'))).toBe(false)
    expect(await isPasswordBreached('password', answer(`${SUFFIX}:0`))).toBe(false)
  })

  it('fails OPEN: an error answer, a network failure or a timeout lets the password through', async () => {
    expect(await isPasswordBreached('password', answer('', false))).toBe(false)
    expect(await isPasswordBreached('password', vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch)).toBe(false)
    expect(await isPasswordBreached('password', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')) as unknown as typeof fetch)).toBe(false)
  })
})

describe('checkNewPassword', () => {
  const ctx = { email: 'priya.sharma@example.com' }

  it('refuses a password containing the company name or the start of the email, in any letter case', async () => {
    for (const pw of ['MyOcarPassword99', 'ocar-admin-2026!', 'xxPriya.Sharmaxx1', 'priya.sharma-2026-x']) {
      expect(await checkNewPassword(pw, ctx, { breachCheck: false }), pw).toBe(CONTEXT_PASSWORD_MESSAGE)
    }
  })

  it('an email start shorter than 4 characters is not used as a rule (it would reject too many fine passwords)', async () => {
    expect(await checkNewPassword('correct-horse-battery-ab', { email: 'ab@example.com' }, { breachCheck: false })).toBeNull()
  })

  it('refuses a breached password with its own message, and accepts one that is not', async () => {
    expect(await checkNewPassword('password-1234-xyz', ctx, { breachCheck: true, fetchImpl: answer(`${'A'.repeat(35)}:1`) })).toBeNull()
    const hit = answer('')
    const sha1Of = (await import('crypto')).createHash('sha1').update('Tr0ub4dor&3-horse-staple').digest('hex').toUpperCase()
    ;(hit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: async () => `${sha1Of.slice(5)}:77` })
    expect(await checkNewPassword('Tr0ub4dor&3-horse-staple', ctx, { breachCheck: true, fetchImpl: hit })).toBe(WEAK_PASSWORD_MESSAGE)
  })

  it('does not call the breach service at all when the check is switched off', async () => {
    const f = answer('')
    expect(await checkNewPassword('totally-unique-passphrase-9', ctx, { breachCheck: false, fetchImpl: f })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('a context failure is reported before any network call is made', async () => {
    const f = answer('')
    expect(await checkNewPassword('ocar-ocar-ocar-1', ctx, { breachCheck: true, fetchImpl: f })).toBe(CONTEXT_PASSWORD_MESSAGE)
    expect(f).not.toHaveBeenCalled()
  })
})
