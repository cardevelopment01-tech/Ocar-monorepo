import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cfg = vi.hoisted(() => ({
  EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'Ocar Admin <no-reply@ocar.example>', SES_FROM_EMAIL: '', SES_REGION: 'ap-south-1',
  SMTP_HOST: 'smtp-relay.gmail.com', SMTP_PORT: 587, SMTP_USER: 'no-reply@ocar.example', SMTP_PASS: 'app-password-123', SMTP_SECURITY: 'starttls',
  NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'false', S3_ACCESS_KEY: '', S3_SECRET_KEY: '',
}))
const mail = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }))
const ses = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/config', () => ({ config: cfg }))
vi.mock('nodemailer', () => ({ default: { createTransport: mail.createTransport } }))
vi.mock('@aws-sdk/client-sesv2', () => ({ SESv2Client: class { send = ses.send }, SendEmailCommand: class { constructor(public input: unknown) {} } }))

// Value: protects=with the SMTP service chosen (Google Workspace), an email goes through it with both parts, the right sender, reply
// address and sign-in, over an encrypted connection that is REQUIRED (never quietly downgraded); the Amazon service is not touched; an
// existing Amazon-only setup (no EMAIL_FROM) is unchanged; and a failed send is an error, not a success;
// fails_when=SMTP is used without TLS in production, the password is sent when none is set (or not sent when it is), the HTML or reply
// address is dropped, the wrong service is used, SES_FROM_EMAIL stops working, or an SMTP failure is swallowed;
// why_new=the app could only send through Amazon SES, which needs a domain, DNS records and a 96-hour approval; seam=nodemailer and the
// Amazon client are replaced; no_claim=a real server (email-smtp-wire.test.ts talks to a real local one).

describe('sendEmail over SMTP', () => {
  let sendEmail: typeof import('@/lib/email').sendEmail
  let log: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules() // the transport is created once per module load
    mail.createTransport.mockReturnValue({ sendMail: mail.sendMail })
    mail.sendMail.mockResolvedValue({ messageId: 'x' })
    Object.assign(cfg, {
      EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'Ocar Admin <no-reply@ocar.example>', SES_FROM_EMAIL: '', SMTP_HOST: 'smtp-relay.gmail.com', SMTP_PORT: 587,
      SMTP_USER: 'no-reply@ocar.example', SMTP_PASS: 'app-password-123', SMTP_SECURITY: 'starttls', NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'false',
    })
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    ;({ sendEmail } = await import('@/lib/email'))
  })
  afterEach(() => log.mockRestore())

  it('sends text, HTML, sender and reply address through the SMTP server, and never touches Amazon', async () => {
    await sendEmail('new@ocar.example', 'Subject ₹', { text: 'plain', html: '<p>rich</p>', replyTo: 'priya@ocar.example' })
    expect(mail.sendMail).toHaveBeenCalledWith({
      from: 'Ocar Admin <no-reply@ocar.example>', to: 'new@ocar.example', subject: 'Subject ₹', text: 'plain', html: '<p>rich</p>', replyTo: 'priya@ocar.example',
    })
    expect(ses.send).not.toHaveBeenCalled()
  })

  it('leaves out html and reply-to when there are none (a plain string still works)', async () => {
    await sendEmail('a@x.test', 's', 'just text')
    expect(mail.sendMail.mock.calls[0]![0]).toEqual({ from: 'Ocar Admin <no-reply@ocar.example>', to: 'a@x.test', subject: 's', text: 'just text' })
  })

  it('connects with the settings it was given: host, port, sign-in, and TLS REQUIRED on the standard port', async () => {
    await sendEmail('a@x.test', 's', 't')
    expect(mail.createTransport).toHaveBeenCalledTimes(1)
    expect(mail.createTransport.mock.calls[0]![0]).toMatchObject({
      host: 'smtp-relay.gmail.com', port: 587, secure: false, requireTLS: true, ignoreTLS: false,
      auth: { user: 'no-reply@ocar.example', pass: 'app-password-123' },
    })
  })

  it('the transport is built once and reused (one connection setup, not one per email)', async () => {
    await sendEmail('a@x.test', 's', 't')
    await sendEmail('b@x.test', 's', 't')
    expect(mail.createTransport).toHaveBeenCalledTimes(1)
    expect(mail.sendMail).toHaveBeenCalledTimes(2)
  })

  it('port 465 (ssl) is encrypted from the first byte and needs no upgrade', async () => {
    Object.assign(cfg, { SMTP_PORT: 465, SMTP_SECURITY: 'ssl' })
    vi.resetModules(); ;({ sendEmail } = await import('@/lib/email'))
    await sendEmail('a@x.test', 's', 't')
    expect(mail.createTransport.mock.calls[0]![0]).toMatchObject({ port: 465, secure: true, requireTLS: false })
  })

  it('an IP-allowlisted relay (no user, no password) sends no sign-in at all', async () => {
    Object.assign(cfg, { SMTP_USER: '', SMTP_PASS: '' })
    vi.resetModules(); ;({ sendEmail } = await import('@/lib/email'))
    await sendEmail('a@x.test', 's', 't')
    expect(mail.createTransport.mock.calls[0]![0]).not.toHaveProperty('auth')
  })

  it("'none' (local testing) turns encryption off explicitly, and only then", async () => {
    Object.assign(cfg, { SMTP_SECURITY: 'none', NODE_ENV: 'development' })
    vi.resetModules(); ;({ sendEmail } = await import('@/lib/email'))
    await sendEmail('a@x.test', 's', 't')
    expect(mail.createTransport.mock.calls[0]![0]).toMatchObject({ ignoreTLS: true, requireTLS: false, secure: false })
  })

  it('has timeouts, so a hung server fails the job in seconds and it is retried (an admin is waiting on this email)', async () => {
    await sendEmail('a@x.test', 's', 't')
    const o = mail.createTransport.mock.calls[0]![0] as Record<string, number>
    expect(o['connectionTimeout']).toBeLessThanOrEqual(15_000)
    expect(o['greetingTimeout']).toBeLessThanOrEqual(15_000)
    expect(o['socketTimeout']).toBeLessThanOrEqual(30_000)
  })

  it('a refused or failed send is an error, so the job retries and is marked failed', async () => {
    mail.sendMail.mockRejectedValue(new Error('550 5.7.1 Relaying denied'))
    await expect(sendEmail('a@x.test', 's', 't')).rejects.toThrow('Relaying denied')
  })

  it('no sender configured: production fails and prints nothing; the sender setting of the old Amazon setup still counts as a sender', async () => {
    Object.assign(cfg, { EMAIL_FROM: '', SES_FROM_EMAIL: '' })
    vi.resetModules(); ;({ sendEmail } = await import('@/lib/email'))
    await expect(sendEmail('a@x.test', 's', 'link')).rejects.toThrow(/EMAIL_FROM \/ SES_FROM_EMAIL is empty/)
    expect(log).not.toHaveBeenCalled()
    expect(mail.sendMail).not.toHaveBeenCalled()

    Object.assign(cfg, { EMAIL_FROM: '', SES_FROM_EMAIL: 'Ocar <old@ocar.example>' })
    vi.resetModules(); ;({ sendEmail } = await import('@/lib/email'))
    await sendEmail('a@x.test', 's', 't')
    expect(mail.sendMail.mock.calls[0]![0]).toMatchObject({ from: 'Ocar <old@ocar.example>' })
  })
})

describe('sendEmail over Amazon SES (unchanged)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    ses.send.mockResolvedValue({})
  })

  it('still uses SES when that is the chosen service, with SES_FROM_EMAIL as the sender, and never opens an SMTP connection', async () => {
    Object.assign(cfg, { EMAIL_PROVIDER: 'ses', EMAIL_FROM: '', SES_FROM_EMAIL: 'Ocar <ses@ocar.example>', NODE_ENV: 'production' })
    const { sendEmail } = await import('@/lib/email')
    await sendEmail('a@x.test', 'Subject', { text: 't', html: 'h' })
    expect((ses.send.mock.calls[0]![0] as { input: { FromEmailAddress: string } }).input.FromEmailAddress).toBe('Ocar <ses@ocar.example>')
    expect(mail.createTransport).not.toHaveBeenCalled()
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it('EMAIL_FROM wins over SES_FROM_EMAIL when both are set', async () => {
    Object.assign(cfg, { EMAIL_PROVIDER: 'ses', EMAIL_FROM: 'Ocar <new@ocar.example>', SES_FROM_EMAIL: 'Ocar <ses@ocar.example>' })
    const { sendEmail } = await import('@/lib/email')
    await sendEmail('a@x.test', 's', 't')
    expect((ses.send.mock.calls[0]![0] as { input: { FromEmailAddress: string } }).input.FromEmailAddress).toBe('Ocar <new@ocar.example>')
  })
})
