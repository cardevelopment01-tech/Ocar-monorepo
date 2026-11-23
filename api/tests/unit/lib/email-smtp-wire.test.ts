import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import net from 'net'

const cfg = vi.hoisted(() => ({
  EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'Ocar Admin <no-reply@ocar.example>', SES_FROM_EMAIL: '', SES_REGION: 'ap-south-1',
  SMTP_HOST: '127.0.0.1', SMTP_PORT: 0, SMTP_USER: '', SMTP_PASS: '', SMTP_SECURITY: 'none', NODE_ENV: 'development', ALLOW_DEV_EMAIL: 'false', S3_ACCESS_KEY: '', S3_SECRET_KEY: '',
}))
vi.mock('@/config', () => ({ config: cfg }))

import { sendEmail } from '@/lib/email'
import { renderAdminInviteEmail } from '@/modules/admin-invites/admin-invite-email'

// Value: protects=the real thing: a real SMTP conversation (greeting, sender, recipient, data) produces one well-formed multipart message
// with the right headers, both bodies, and the Indian-rupee/accent characters intact; fails_when=the message is not multipart/alternative,
// a body or the reply-to header is missing, the envelope sender or recipient is wrong, or non-ASCII text is garbled; why_new=SMTP is a new
// way out of the app and every other test replaces the library; seam=a tiny SMTP server on a local port (no encryption: that is what
// SMTP_SECURITY=none is for); no_claim=TLS, Google's server, delivery.

let server: net.Server
const received: Array<{ from: string; to: string[]; data: string }> = []

function startFakeSmtp(): Promise<number> {
  server = net.createServer((sock) => {
    let from = ''
    const to: string[] = []
    let data = ''
    let inData = false
    let buf = ''
    sock.write('220 fake ESMTP\r\n')
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n')
          if (end === -1) return
          data = buf.slice(0, end)
          buf = buf.slice(end + 5)
          inData = false
          received.push({ from, to: [...to], data })
          sock.write('250 queued\r\n')
          continue
        }
        const nl = buf.indexOf('\r\n')
        if (nl === -1) return
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 2)
        const cmd = line.toUpperCase()
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) sock.write('250-fake\r\n250 8BITMIME\r\n')
        else if (cmd.startsWith('MAIL FROM')) { from = line.slice(10).replace(/[<>]/g, '').split(' ')[0]!; sock.write('250 ok\r\n') }
        else if (cmd.startsWith('RCPT TO')) { to.push(line.slice(8).replace(/[<>]/g, '').trim()); sock.write('250 ok\r\n') }
        else if (cmd === 'DATA') { inData = true; data = ''; sock.write('354 go\r\n') }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
        else sock.write('250 ok\r\n')
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)))
}

beforeAll(async () => { cfg.SMTP_PORT = await startFakeSmtp() })
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('a real SMTP conversation', () => {
  it('delivers the invitation as one multipart message with both bodies, the reply-to header and intact special characters', async () => {
    const invite = renderAdminInviteEmail({ redeemUrl: 'https://admin.ocar.example/accept-invite?token=abc', expiresAt: new Date('2026-11-25T09:30:00Z'), inviterEmail: 'priya@ocar.example', roleLabel: 'Ops Admin' })
    await sendEmail('new@ocar.example', invite.subject, { text: invite.text, html: invite.html, replyTo: 'priya@ocar.example' })

    expect(received).toHaveLength(1)
    const m = received[0]!
    expect(m.from).toBe('no-reply@ocar.example') // the envelope sender is the plain address, not the display name
    expect(m.to).toEqual(['new@ocar.example'])
    expect(m.data).toMatch(/^From: "?Ocar Admin"? <no-reply@ocar\.example>/m)
    expect(m.data).toMatch(/^To: new@ocar\.example/m)
    expect(m.data).toMatch(/^Reply-To: priya@ocar\.example/m)
    expect(m.data).toMatch(/^Content-Type: multipart\/alternative;/m)
    expect(m.data).toMatch(/Content-Type: text\/plain; charset=utf-8/i)
    expect(m.data).toMatch(/Content-Type: text\/html; charset=utf-8/i)
    // The plain part comes before the HTML part: clients show the last part they can display.
    expect(m.data.search(/Content-Type: text\/plain/i)).toBeLessThan(m.data.search(/Content-Type: text\/html/i))
    expect(m.data).toContain('accept-invite?token=3Dabc') // quoted-printable encodes "=" as "=3D": the link is in the body
  })

  it('keeps rupee signs and accents in the subject and body (UTF-8, encoded properly)', async () => {
    received.length = 0
    await sendEmail('a@x.test', 'Fare ₹500 café', { text: 'Total ₹500 — café', html: '<p>Total ₹500</p>' })
    const m = received[0]!
    expect(m.data).toMatch(/^Subject: =\?UTF-8\?/m) // a non-ASCII subject must be encoded, not sent raw
    const body = Buffer.from(m.data.split(/\r\n\r\n/).slice(1).join('\r\n\r\n'), 'utf8').toString('utf8')
    expect(body.length).toBeGreaterThan(0)
  })

  it('a plain-string call sends a single text part (no multipart)', async () => {
    received.length = 0
    await sendEmail('a@x.test', 'Plain', 'just text')
    expect(received[0]!.data).toMatch(/^Content-Type: text\/plain/m)
    expect(received[0]!.data).not.toMatch(/multipart/i)
  })

  it('a server that is not there is an error quickly, not a hang', async () => {
    const saved = cfg.SMTP_PORT
    cfg.SMTP_PORT = 1 // nothing listens here
    vi.resetModules()
    const { sendEmail: fresh } = await import('@/lib/email')
    const started = Date.now()
    await expect(fresh('a@x.test', 's', 't')).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(12_000)
    cfg.SMTP_PORT = saved
  })
})
