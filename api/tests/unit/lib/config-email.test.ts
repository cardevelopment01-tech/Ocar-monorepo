import { describe, it, expect } from 'vitest'
import { envSchemaChecked } from '@/config'

// Value: protects=the email settings are safe by default (Amazon unless asked, TLS on, Google's relay address and the standard port filled
// in), a half-set sign-in or an unencrypted production connection stops the server from starting instead of failing at the first invite;
// fails_when=SMTP becomes the default, the password can be set without the user (or the reverse), or "no encryption" is accepted in
// production; why_new=SMTP settings did not exist; seam=the env schema; no_claim=a real server.

const urls = { API_BASE_URL: 'https://api.example.com', USER_APP_URL: 'https://app.example.com', DRIVER_APP_URL: 'https://driver.example.com' }
const prod = { ...process.env, NODE_ENV: 'production', PAYU_KEY: 'k', PAYU_SALT: 's', BULKSMSPLANS_API_ID: 'id', BULKSMSPLANS_API_PASSWORD: 'pw', ...urls }
const ok = (over: Record<string, string>) => envSchemaChecked.safeParse({ ...prod, ...over })

describe('email settings', () => {
  it('defaults: Amazon SES, Google relay host, port 587 with STARTTLS, no sign-in, no sender', () => {
    const d = ok({}).data!
    expect(d).toMatchObject({ EMAIL_PROVIDER: 'ses', EMAIL_FROM: '', SMTP_HOST: 'smtp-relay.gmail.com', SMTP_PORT: 587, SMTP_USER: '', SMTP_PASS: '', SMTP_SECURITY: 'starttls' })
  })

  it('accepts a complete Google Workspace setup', () => {
    const r = ok({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'Ocar Admin <no-reply@ocar.example>', SMTP_USER: 'no-reply@ocar.example', SMTP_PASS: 'abcd efgh ijkl mnop' })
    expect(r.success).toBe(true)
    expect(r.data!.SMTP_PORT).toBe(587)
  })

  it('accepts an IP-allowlisted relay (no sign-in at all), and port 465 with ssl', () => {
    expect(ok({ EMAIL_PROVIDER: 'smtp' }).success).toBe(true)
    expect(ok({ EMAIL_PROVIDER: 'smtp', SMTP_PORT: '465', SMTP_SECURITY: 'ssl' }).data!.SMTP_PORT).toBe(465)
  })

  it('refuses a user without a password, or a password without a user (a half-set sign-in fails at the first email otherwise)', () => {
    expect(ok({ SMTP_USER: 'u@ocar.example' }).success).toBe(false)
    expect(ok({ SMTP_PASS: 'secret' }).success).toBe(false)
  })

  it('refuses an unknown service, security mode, or an impossible port', () => {
    expect(ok({ EMAIL_PROVIDER: 'sendgrid' }).success).toBe(false)
    expect(ok({ SMTP_SECURITY: 'maybe' }).success).toBe(false)
    expect(ok({ SMTP_PORT: '0' }).success).toBe(false)
    expect(ok({ SMTP_PORT: '70000' }).success).toBe(false)
  })

  it("'none' (no encryption) is refused in production and fine in development", () => {
    expect(ok({ SMTP_SECURITY: 'none' }).success).toBe(false)
    expect(envSchemaChecked.safeParse({ ...process.env, NODE_ENV: 'development', SMTP_SECURITY: 'none' }).success).toBe(true)
  })
})
