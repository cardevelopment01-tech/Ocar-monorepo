import { describe, it, expect, vi, beforeEach } from 'vitest'

const cfg = vi.hoisted(() => ({ ADMIN_APP_URL: 'https://admin.ocar.example', NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'false' }))
const send = vi.hoisted(() => vi.fn())
vi.mock('@/config', () => ({ config: cfg }))
vi.mock('@/lib/email', () => ({ sendEmail: send }))

import { formatIst, renderAdminInviteEmail, sendAdminInviteEmail, inviteLink, INVITE_TTL_HOURS } from '@/modules/admin-invites/admin-invite-email'

// Value: protects=the invitation a new admin receives is clear, safe and correct: it says who invited them and as what, shows the expiry in
// Indian time, carries exactly one working link, is readable in both HTML and plain text, cannot be broken by odd characters in a name or
// role, loads nothing from the internet, and a button people can actually read; and an invitation that could never work (a localhost link
// in production) is not sent; fails_when=the link is wrong or missing in either version, markup injected through an address or role renders,
// the expiry is UTC or says the wrong time, the button text drops below 4.5:1 contrast, an old queued job (no inviter or role) breaks, or a dead
// localhost link goes out in production; why_new=the email was a plain-text note with a raw UTC timestamp and no inviter or role;
// seam=the sender and config are replaced; no_claim=how any real email client draws it.

const URL = 'https://admin.ocar.example/accept-invite?token=abc123'
const WHEN = new Date('2026-11-25T09:30:00.000Z') // 3:00 pm in India

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe('formatIst', () => {
  it('shows Indian time in words, whatever the server clock says', () => {
    expect(formatIst(WHEN)).toBe('Wed, 25 Nov 2026, 3:00 pm IST')
    expect(formatIst(new Date('2026-11-25T18:30:00.000Z'))).toBe('Thu, 26 Nov 2026, 12:00 am IST') // midnight India time is the next day
    expect(formatIst(new Date('2026-01-05T06:45:00.000Z'))).toBe('Mon, 5 Jan 2026, 12:15 pm IST')
  })
})

describe('renderAdminInviteEmail', () => {
  const full = renderAdminInviteEmail({ redeemUrl: URL, expiresAt: WHEN, inviterEmail: 'priya@ocar.example', roleLabel: 'Ops Admin' })

  it('names the role in the subject and the inviter in the first sentence, in both versions', () => {
    expect(full.subject).toBe("You're invited to the Ocar admin panel as Ops Admin")
    expect(full.text).toContain('priya@ocar.example invited you to join the Ocar admin panel as Ops Admin.')
    expect(full.html).toContain('priya@ocar.example invited you to join the Ocar admin panel as Ops Admin.')
  })

  it('carries the link in the text and, as a button and as a fallback, in the HTML, and nothing else points anywhere', () => {
    expect(full.text).toContain(URL)
    expect(full.html.split(`href="${URL}"`).length - 1).toBe(2) // the button and the "copy this link" line
    const hrefs = [...full.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
    expect(new Set(hrefs)).toEqual(new Set([URL]))
    expect(full.html).toContain('Activate your account')
  })

  it('says when it expires in Indian time, that it works once, and how long it is valid, in both versions', () => {
    for (const body of [full.text, full.html]) {
      expect(body).toContain('Wed, 25 Nov 2026, 3:00 pm IST')
      expect(body).toContain(`${INVITE_TTL_HOURS} hours`)
      expect(body).not.toContain('2026-11-25T09:30') // never the raw machine timestamp
    }
    expect(full.text).toContain('works once')
    expect(full.html).toMatch(/Works<\/td><td[^>]*>once/)
  })

  it('gives the password rule, the "not expecting this" notice, and who to reply to', () => {
    for (const body of [full.text, full.html]) {
      expect(body).toContain('12 or more characters')
      expect(body).toContain('Not expecting this?')
      expect(body).toContain('Do not forward it')
      expect(body).toContain('Reply to this email to reach priya@ocar.example.')
    }
  })

  it('the plain-text version is plain: no tags, no entities', () => {
    expect(full.text).not.toMatch(/<[a-z!/]/i)
    expect(full.text).not.toMatch(/&(amp|lt|gt|quot|#39);/)
  })

  it('a preheader (the preview line in the inbox) is present and hidden in the body', () => {
    expect(full.html).toMatch(/display:none[^>]*>Set your password to activate your account\. The link works once and is valid for 48 hours\.</)
  })

  it('values with special characters are escaped in the HTML (and left as typed in the text), so nothing can be injected', () => {
    const hostile = renderAdminInviteEmail({
      redeemUrl: 'https://admin.ocar.example/accept-invite?token=a&b="c"',
      expiresAt: WHEN,
      inviterEmail: "o'brien&co@x.test",
      roleLabel: '<img src=x onerror=alert(1)><script>alert(2)</script>',
    })
    expect(hostile.html).toContain('o&#39;brien&amp;co@x.test')
    expect(hostile.html).toContain('href="https://admin.ocar.example/accept-invite?token=a&amp;b=&quot;c&quot;"')
    expect(hostile.html).not.toMatch(/<img|<script/i)
    expect(hostile.html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
    expect(hostile.text).toContain("o'brien&co@x.test")
  })

  it('greets the person by name when there is one, escaped, and says nothing extra when there is not', () => {
    const named = renderAdminInviteEmail({ redeemUrl: URL, expiresAt: WHEN, fullName: 'Priya <b>Das</b> & Co' })
    expect(named.text).toContain('Hi Priya <b>Das</b> & Co,')
    expect(named.html).toContain('Hi Priya &lt;b&gt;Das&lt;/b&gt; &amp; Co,')
    expect(named.html).not.toContain('<b>Das')
    expect(full.text).not.toMatch(/\nHi /)
    expect(full.html).not.toMatch(/>Hi /)
  })

  it('loads nothing from the internet: no images, scripts, stylesheets or fonts to be blocked or to track opens', () => {
    expect(full.html).not.toMatch(/<img|<script|<link|<iframe|src=|@import|url\(/i)
  })

  it('the button text is readable: at least 4.5:1 against its background (the brand teal on white is only 3.8:1)', () => {
    const style = full.html.match(/<a href="[^"]*"[^>]*style="([^"]*)"/)![1]!
    const bg = style.match(/background-color:(#[0-9A-Fa-f]{6})/)![1]!
    const fg = style.match(/(?:^|;)color:(#[0-9A-Fa-f]{6})/)![1]!
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('is a complete, mobile-aware document', () => {
    expect(full.html).toMatch(/^<!doctype html>/i)
    expect(full.html).toContain('<html lang="en">')
    expect(full.html).toContain('name="viewport"')
    expect(full.html).toContain('<title>You&#39;re invited to the Ocar admin panel as Ops Admin</title>')
    expect(full.html).toContain('role="presentation"') // layout tables are not announced as data tables
  })

  it('an invitation from before inviter and role were recorded still reads fine: no "undefined", no empty rows, no reply line', () => {
    const old = renderAdminInviteEmail({ redeemUrl: URL, expiresAt: WHEN })
    expect(old.subject).toBe("You're invited to the Ocar admin panel")
    for (const body of [old.text, old.html]) {
      expect(body).toContain('You have been invited to join the Ocar admin panel.')
      expect(body).not.toMatch(/undefined|null|Invited by|Reply to this email/)
      expect(body).toContain(URL)
    }
    expect(old.html).not.toContain('>Role<')
  })
})

describe('sendAdminInviteEmail', () => {
  const job = { email: 'new@ocar.example', rawToken: 'tok/with+odd=chars', expiresAt: WHEN.toISOString(), inviterEmail: 'priya@ocar.example', role: 'ops_admin' as const }
  beforeEach(() => {
    send.mockReset()
    send.mockResolvedValue(undefined)
    Object.assign(cfg, { ADMIN_APP_URL: 'https://admin.ocar.example', NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'false' })
  })

  it('sends one email to the invitee with both versions, the role by its name, and replies going to the inviter', async () => {
    await sendAdminInviteEmail(job)
    expect(send).toHaveBeenCalledTimes(1)
    const [to, subject, content] = send.mock.calls[0]! as [string, string, { text: string; html: string; replyTo?: string }]
    expect(to).toBe('new@ocar.example')
    expect(subject).toBe("You're invited to the Ocar admin panel as Ops Admin")
    expect(content.replyTo).toBe('priya@ocar.example')
    expect(content.text).toContain('as Ops Admin')
    expect(content.html).toContain('as Ops Admin')
  })

  it('builds the link from the admin app address (a trailing slash does not double up) and encodes the token', async () => {
    cfg.ADMIN_APP_URL = 'https://admin.ocar.example/'
    await sendAdminInviteEmail(job)
    const content = send.mock.calls[0]![2] as { text: string }
    expect(content.text).toContain('https://admin.ocar.example/accept-invite?token=tok%2Fwith%2Bodd%3Dchars')
    expect(content.text).not.toContain('example//accept')
  })

  it('only the site address is used: a page address with a path or query in the setting does not end up inside the link', async () => {
    cfg.ADMIN_APP_URL = 'https://admin.ocarindia.com/dispatch?lane=needs_driver'
    await sendAdminInviteEmail(job)
    const content = send.mock.calls[0]![2] as { text: string; html: string }
    expect(content.text).toContain('https://admin.ocarindia.com/accept-invite?token=tok%2Fwith%2Bodd%3Dchars')
    expect(content.text).not.toContain('dispatch')
    expect(content.html).not.toContain('dispatch')
    send.mockClear()
    cfg.ADMIN_APP_URL = ' https://admin.ocarindia.com/ '
    await sendAdminInviteEmail(job)
    expect((send.mock.calls[0]![2] as { text: string }).text).toContain('https://admin.ocarindia.com/accept-invite?token=')
  })

  it('an invitation queued before inviter and role existed still sends, without a reply address', async () => {
    await sendAdminInviteEmail({ email: 'new@ocar.example', rawToken: 'abc', expiresAt: WHEN.toISOString() })
    const content = send.mock.calls[0]![2] as Record<string, unknown>
    expect(content).not.toHaveProperty('replyTo')
    expect(send.mock.calls[0]![1]).toBe("You're invited to the Ocar admin panel")
  })

  it('a role it has no name for is shown as it is, not dropped', async () => {
    await sendAdminInviteEmail({ ...job, role: 'new_role' as never })
    expect(send.mock.calls[0]![1]).toBe("You're invited to the Ocar admin panel as new_role")
  })

  it('in production it will not send a link that cannot work (localhost, or not https), and says what to set', async () => {
    for (const url of ['http://localhost:3002', 'https://localhost', 'http://admin.ocar.example', '127.0.0.1:3002']) {
      cfg.ADMIN_APP_URL = url
      await expect(sendAdminInviteEmail(job), url).rejects.toThrow(/ADMIN_APP_URL is not a public https address/)
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('outside production a local link is fine (that is where it is tested), and a non-production server that opted in is too', async () => {
    cfg.ADMIN_APP_URL = 'http://localhost:3002'
    cfg.NODE_ENV = 'development'
    await sendAdminInviteEmail(job)
    cfg.NODE_ENV = 'production'
    cfg.ALLOW_DEV_EMAIL = 'true'
    await sendAdminInviteEmail(job)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('a failure to send reaches the job, so it is retried and marked failed', async () => {
    send.mockRejectedValue(new Error('SES rejected it'))
    await expect(sendAdminInviteEmail(job)).rejects.toThrow('SES rejected it')
  })
})

describe('inviteLink (the same address in the email and in "copy link")', () => {
  beforeEach(() => Object.assign(cfg, { ADMIN_APP_URL: 'https://admin.ocar.example', NODE_ENV: 'production', ALLOW_DEV_EMAIL: 'false' }))

  it('builds the activation link on the site address and encodes the token', () => {
    expect(inviteLink('abc')).toBe('https://admin.ocar.example/accept-invite?token=abc')
    expect(inviteLink('a/b+c=')).toBe('https://admin.ocar.example/accept-invite?token=a%2Fb%2Bc%3D')
  })

  it('refuses to hand out a link that cannot work in production, so no invite is created with one', () => {
    for (const url of ['http://localhost:3002', 'https://localhost', 'http://admin.ocar.example', '127.0.0.1:3002']) {
      cfg.ADMIN_APP_URL = url
      expect(() => inviteLink('abc'), url).toThrow(/ADMIN_APP_URL is not a public https address/)
    }
  })

  it('a local link is fine outside production', () => {
    Object.assign(cfg, { ADMIN_APP_URL: 'http://localhost:3002', NODE_ENV: 'development' })
    expect(inviteLink('abc')).toBe('http://localhost:3002/accept-invite?token=abc')
  })
})
