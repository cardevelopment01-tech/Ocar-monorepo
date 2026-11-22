import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cfg = vi.hoisted(() => ({
  SES_REGION: 'ap-south-1', SES_FROM_EMAIL: 'Ocar Admin <no-reply@ocar.example>', NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'false', S3_ACCESS_KEY: '', S3_SECRET_KEY: '',
}))
const ses = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/config', () => ({ config: cfg }))
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class { send = ses.send },
  SendEmailCommand: class { constructor(public input: unknown) {} },
}))

import { sendEmail, EmailNotConfiguredError } from '@/lib/email'

// Value: protects=an email goes out as a proper two-part message with the right sender and reply address; and when no sender is set up it is
// never reported as sent and its contents (an invite link is a live credential) are never written to the log, except on a developer's
// machine or an environment that opted in on purpose; fails_when=the HTML or plain-text part goes missing, a reply goes to the wrong place,
// an unconfigured production server logs the email or says it sent it, or a send error is swallowed; why_new=the sender used to print the whole
// email to the log and report success whenever the sender address was empty, in any environment; seam=the Amazon email client and config are
// replaced; no_claim=real delivery.

describe('sendEmail', () => {
  let log: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.clearAllMocks()
    ses.send.mockResolvedValue({})
    Object.assign(cfg, { SES_FROM_EMAIL: 'Ocar Admin <no-reply@ocar.example>', NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'false' })
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => log.mockRestore())

  const sent = () => (ses.send.mock.calls[0]![0] as { input: Record<string, any> }).input

  it('sends both the plain-text and the HTML version, from the configured sender, as UTF-8', async () => {
    await sendEmail('new@ocar.example', 'Subject ₹', { text: 'plain', html: '<p>rich</p>' })
    expect(ses.send).toHaveBeenCalledTimes(1)
    expect(sent()).toMatchObject({
      FromEmailAddress: 'Ocar Admin <no-reply@ocar.example>',
      Destination: { ToAddresses: ['new@ocar.example'] },
      Content: { Simple: { Subject: { Data: 'Subject ₹', Charset: 'UTF-8' }, Body: { Text: { Data: 'plain', Charset: 'UTF-8' }, Html: { Data: '<p>rich</p>', Charset: 'UTF-8' } } } },
    })
  })

  it('a reply address is set only when given, and a plain string still sends as text only (the old way)', async () => {
    await sendEmail('a@x.test', 's', { text: 't', html: 'h', replyTo: 'priya@ocar.example' })
    expect(sent()['ReplyToAddresses']).toEqual(['priya@ocar.example'])
    ses.send.mockClear()
    await sendEmail('a@x.test', 's', 'just text')
    expect(sent()).not.toHaveProperty('ReplyToAddresses')
    expect(sent()['Content'].Simple.Body).toEqual({ Text: { Data: 'just text', Charset: 'UTF-8' } })
  })

  it('a send error reaches the caller (so the job retries and is marked failed)', async () => {
    ses.send.mockRejectedValue(new Error('MessageRejected: sender not verified'))
    await expect(sendEmail('a@x.test', 's', 't')).rejects.toThrow('MessageRejected')
  })

  describe('with no sender configured', () => {
    beforeEach(() => { cfg.SES_FROM_EMAIL = '' })

    it('production: fails, sends nothing, and does NOT print the email (the link in it would end up in the log pipeline)', async () => {
      await expect(sendEmail('new@ocar.example', 'Subject', 'link: https://admin/accept-invite?token=SECRET')).rejects.toBeInstanceOf(EmailNotConfiguredError)
      expect(ses.send).not.toHaveBeenCalled()
      expect(log).not.toHaveBeenCalled()
    })

    it('the failure says what is wrong in words an operator can act on', async () => {
      await expect(sendEmail('a@x.test', 's', 't')).rejects.toThrow(/SES_FROM_EMAIL is empty/)
    })

    it('development, test, and an environment that opted in (ALLOW_DEV_EMAIL=true) print it instead, and send nothing', async () => {
      for (const env of [{ NODE_ENV: 'development' }, { NODE_ENV: 'test' }, { NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'true' }]) {
        Object.assign(cfg, { NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'false' }, env)
        log.mockClear()
        await expect(sendEmail('a@x.test', 'Subject', 'the body with the link')).resolves.toBeUndefined()
        expect(log).toHaveBeenCalledWith('[EMAIL DEV]', 'a@x.test', 'Subject', 'the body with the link')
      }
      expect(ses.send).not.toHaveBeenCalled()
    })
  })
})
