import { config } from '@/config'
import { sendEmail } from '@/lib/email'
import type { AdminRole } from '@/constants/enums'

// The invitation email. Defined here (HTML and plain text from one place) rather than in the editable notification_templates table: an
// edit there could drop the {{redeemUrl}} and make every invite unusable, and an edited text part would drift away from the HTML part.

/** How long an invite link works. The service derives the stored expiry from this, so the email can never promise a different time. */
export const INVITE_TTL_HOURS = 48

/** What the queue carries for one invitation email. inviterEmail and role are optional: jobs queued before they existed still have to send. */
export interface AdminInviteEmailJob {
  email: string
  rawToken: string
  /** ISO timestamp */
  expiresAt: string
  inviterEmail?: string
  fullName?: string
  role?: AdminRole
  /** Which invite this email is for, so the outcome can be recorded on it. */
  inviteId?: string
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  ops_admin: 'Ops Admin',
  support_admin: 'Support Admin',
  finance_admin: 'Finance Admin',
}

const IST = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
})

/**
 * "Wed, 25 Nov 2026, 3:00 pm IST": the people reading this are in India, and a UTC timestamp like 2026-11-25T09:30:00.000Z means nothing to
 * them. Built from the parts, not from the library's own pattern, so the wording cannot change when Node's date data does.
 */
export function formatIst(date: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes): string => IST.formatToParts(date).find((x) => x.type === type)?.value ?? ''
  return `${part('weekday')}, ${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()} IST`
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface RenderedInviteEmail { subject: string; text: string; html: string }

export function renderAdminInviteEmail(p: { redeemUrl: string; expiresAt: Date; inviterEmail?: string | undefined; roleLabel?: string | undefined; fullName?: string | undefined }): RenderedInviteEmail {
  const { redeemUrl, inviterEmail, roleLabel, fullName } = p
  const hello = fullName ? `Hi ${fullName},` : ''
  const expires = formatIst(p.expiresAt)
  const asRole = roleLabel ? ` as ${roleLabel}` : ''
  const lead = inviterEmail
    ? `${inviterEmail} invited you to join the Ocar admin panel${asRole}.`
    : `You have been invited to join the Ocar admin panel${asRole}.`
  const subject = `You're invited to the Ocar admin panel${asRole}`
  const preheader = `Set your password to activate your account. The link works once and is valid for ${INVITE_TTL_HOURS} hours.`
  const validity = `The link works once and is valid for ${INVITE_TTL_HOURS} hours, until ${expires}.`
  const passwordTip = 'Choose a password with 12 or more characters. A few random words work well.'
  const notYou = 'Not expecting this? Ignore this email: nothing happens until the link is used. Do not forward it, because anyone with the link can activate this account.'
  const questions = inviterEmail ? `Questions? Reply to this email to reach ${inviterEmail}.` : ''
  const footer = 'Ocar · Internal tool · Authorised personnel only'

  const text = [
    "You're invited to the Ocar admin panel",
    '',
    ...(hello ? [hello, ''] : []),
    lead,
    '',
    'Activate your account:',
    redeemUrl,
    '',
    ...(roleLabel ? [`Role: ${roleLabel}`] : []),
    ...(inviterEmail ? [`Invited by: ${inviterEmail}`] : []),
    validity,
    '',
    passwordTip,
    '',
    notYou,
    ...(questions ? ['', questions] : []),
    '',
    footer,
  ].join('\n')

  const e = escapeHtml
  const detailRow = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;font-size:13px;line-height:20px;color:#64748B;white-space:nowrap;vertical-align:top;">${e(label)}</td><td style="padding:4px 0;font-size:13px;line-height:20px;color:#0F172A;font-weight:600;">${value}</td></tr>`
  const details = [
    ...(roleLabel ? [detailRow('Role', e(roleLabel))] : []),
    ...(inviterEmail ? [detailRow('Invited by', e(inviterEmail))] : []),
    detailRow('Valid for', `${INVITE_TTL_HOURS} hours, until ${e(expires)}`),
    detailRow('Works', 'once'),
  ].join('')
  // Colours are DESIGN.md tokens (ink-900/600/400, border, bg, primary, primary-dark). Email clients cannot use CSS variables, so they are literals.
  // The button is Teal Deep, not the brand teal: white on #0E8FA3 is 3.8:1, on #0A6F80 it is 5.8:1. No dark palette: the admin product has none.
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(subject)}</title>
<style>
  @media only screen and (max-width: 600px) { .pad { padding: 24px 20px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F6FBFB;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${e(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F6FBFB;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#FFFFFF;border:1px solid #DCEBEE;border-radius:16px;">
      <tr><td class="pad" style="padding:32px 36px;font-family:${font};">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td align="center" valign="middle" width="32" height="32" bgcolor="#0E8FA3" style="width:32px;height:32px;background-color:#0E8FA3;background-image:linear-gradient(135deg,#0E8FA3,#14ABBD);border-radius:8px;color:#FFFFFF;font-family:${font};font-size:19px;font-weight:800;line-height:32px;">O</td>
          <td style="padding-left:8px;font-family:${font};font-size:18px;font-weight:800;color:#0F172A;">car</td>
        </tr></table>
        <h1 style="margin:24px 0 8px;font-family:${font};font-size:22px;line-height:28px;font-weight:700;color:#0F172A;">You're invited to the Ocar admin panel</h1>
        ${hello ? `<p style="margin:0 0 8px;font-family:${font};font-size:15px;line-height:23px;color:#0F172A;">${e(hello)}</p>` : ''}
        <p style="margin:0 0 24px;font-family:${font};font-size:15px;line-height:23px;color:#475569;">${e(lead)}</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td align="center" bgcolor="#0A6F80" style="border-radius:10px;background-color:#0A6F80;">
            <a href="${e(redeemUrl)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;background-color:#0A6F80;">Activate your account</a>
          </td>
        </tr></table>
        <p style="margin:16px 0 0;font-family:${font};font-size:12px;line-height:18px;color:#64748B;">Button not working? Copy this link into your browser:<br><a href="${e(redeemUrl)}" style="color:#0A6F80;word-break:break-all;">${e(redeemUrl)}</a></p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0;background-color:#F6FBFB;border:1px solid #DCEBEE;border-radius:12px;">
          <tr><td style="padding:12px 16px;font-family:${font};"><table role="presentation" cellspacing="0" cellpadding="0" border="0">${details}</table></td></tr>
        </table>
        <p style="margin:24px 0 0;font-family:${font};font-size:14px;line-height:22px;color:#475569;">${e(passwordTip)}</p>
        <p style="margin:16px 0 0;font-family:${font};font-size:13px;line-height:20px;color:#64748B;">${e(notYou)}</p>
        ${questions ? `<p style="margin:16px 0 0;font-family:${font};font-size:13px;line-height:20px;color:#64748B;">${e(questions)}</p>` : ''}
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-family:${font};font-size:12px;line-height:18px;color:#64748B;">${e(footer)}</p>
  </td></tr>
</table>
</body>
</html>`

  return { subject, text, html }
}

/**
 * The activation link for a token. Used for the email AND for the copy-link the admin sees, so both are always the same address. Throws when
 * the link could not work (production with no public https ADMIN_APP_URL), rather than hand out a dead link.
 */
export function inviteLink(rawToken: string): string {
  // Only the site address is used (https://admin.example.com). A page address pasted into the setting by mistake, such as
  // https://admin.example.com/dispatch?lane=x, would otherwise end up in front of /accept-invite and break every invite link.
  let base = config.ADMIN_APP_URL.trim().replace(/\/+$/, '')
  try { base = new URL(base).origin } catch { /* not a URL: the checks below refuse it in production */ }
  // ADMIN_APP_URL defaults to http://localhost:3002. If production never set it, the email would carry a dead link that looks fine.
  if (config.NODE_ENV === 'production' && config.ALLOW_DEV_EMAIL !== 'true' && (!/^https:\/\//i.test(base) || /\/\/(localhost|127\.)/i.test(base))) {
    throw new Error('ADMIN_APP_URL is not a public https address, so the invite link would not work. Set it, then invite again.')
  }
  return `${base}/accept-invite?token=${encodeURIComponent(rawToken)}`
}

/** Builds and sends one invitation. Throws (so the job is retried and marked failed) rather than send a link that cannot work. */
export async function sendAdminInviteEmail(job: AdminInviteEmailJob): Promise<void> {
  const rendered = renderAdminInviteEmail({
    redeemUrl: inviteLink(job.rawToken),
    expiresAt: new Date(job.expiresAt),
    inviterEmail: job.inviterEmail,
    fullName: job.fullName,
    roleLabel: job.role ? (ROLE_LABEL[job.role] ?? job.role) : undefined,
  })
  await sendEmail(job.email, rendered.subject, {
    text: rendered.text,
    html: rendered.html,
    // Replies go to the person who invited them, the one who can actually answer.
    ...(job.inviterEmail ? { replyTo: job.inviterEmail } : {}),
  })
}
