import { config } from '@/config'
import { logger } from '@/lib/logger'

// What the vendor told us about one send. Kept so "the app said sent but the phone got nothing" can be answered from our own
// data (notification_logs.provider_response and the sms.sent log line) instead of only from the vendor's dashboard.
export type SmsSendResult = { skipped?: 'synthetic' | 'no-credentials' } & Record<string, string | number | boolean>

// Top-level scalar fields of the vendor's reply, minus anything that echoes the message text (an OTP must never reach a log
// or a long-lived table) and anything oversized. Credentials are never part of a reply, so nothing else needs stripping.
export function pickProviderFields(json: unknown, message: string): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  if (typeof json !== 'object' || json === null) return out
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string' && v.length <= 200 && !v.includes(message) && !(v.length >= 6 && message.includes(v))) out[k] = v
  }
  return out
}

// True when messages are NOT really sent (no vendor credentials). In production this only happens when
// ALLOW_DEV_SMS=true was set deliberately, and server.ts logs a warning at boot so it can't go unnoticed.
export function isSmsBypassActive(): boolean {
  return !config.BULKSMSPLANS_API_ID || !config.BULKSMSPLANS_API_PASSWORD
}

// The seeded load-test accounts (riders 9999000001-9999050000, drivers 8888000001-8888000400). They are valid-format
// mobile numbers that may belong to real people, so never text them. The ranges are exactly the seeded rows: phone is
// unique, so no real user can hold one of these numbers and be skipped by mistake (OTP login goes through sendSms too).
const SYNTHETIC_RANGES: ReadonlyArray<readonly [number, number]> = [[9_999_000_001, 9_999_050_000], [8_888_000_001, 8_888_000_400]]

export function isSyntheticPhone(phone: string): boolean {
  const n = Number(phone.replace(/\D/g, '').slice(-10))
  return SYNTHETIC_RANGES.some(([lo, hi]) => n >= lo && n <= hi)
}

export async function sendSms(phone: string, message: string, templateId?: string): Promise<SmsSendResult> {
  if (isSyntheticPhone(phone)) {
    console.log('[SMS] skipped, load-test phone:', phone)
    return { skipped: 'synthetic' }
  }
  if (isSmsBypassActive()) {
    // Message body is deliberately not logged: it carries OTPs.
    console.log('[SMS DEV] not sent (no provider credentials):', phone)
    return { skipped: 'no-credentials' }
  }

  // Only strips a leading country code when there are actually more than 10
  // digits left afterwards — a bare `/^\+?91/` also matched (and corrupted)
  // a valid 10-digit number that happens to start with "91", e.g. 9123456789.
  const allDigits = phone.replace(/\D/g, '')
  const stripped = allDigits.length > 10 && allDigits.startsWith('91') ? allDigits.slice(2) : allDigits

  const body: Record<string, string> = {
    api_id: config.BULKSMSPLANS_API_ID,
    api_password: config.BULKSMSPLANS_API_PASSWORD,
    sms_type: 'Transactional',
    sms_encoding: '1', // 1 = Text
    sender: config.BULKSMSPLANS_SENDER_ID,
    number: stripped,
    message,
  }
  if (templateId) body['template_id'] = templateId

  const res = await fetch('https://www.bulksmsplans.com/api/send_sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // The vendor has answered with an HTML error page before (21 Nov 2026); say so instead of "Unexpected token '<'".
  const raw = await res.text()
  let json: { code?: number; message?: string }
  try { json = JSON.parse(raw) as { code?: number; message?: string } }
  catch { throw new Error(`SMS provider returned a non-JSON reply (HTTP ${res.status})`) }

  const fields = pickProviderFields(json, message)
  const logBase = { event: 'sms.sent', phone_tail: stripped.slice(-4), http_status: res.status, template_id: templateId ?? null, provider: fields }
  if (!res.ok || json.code !== 200) {
    logger.warn({ ...logBase, event: 'sms.rejected' }, 'sms rejected by provider')
    throw new Error(json.message ?? 'SMS send failed')
  }
  logger.info(logBase, 'sms accepted by provider')
  return { http_status: res.status, ...fields }
}
