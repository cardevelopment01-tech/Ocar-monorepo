import { config } from '@/config'

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

export async function sendSms(phone: string, message: string, templateId?: string): Promise<void> {
  if (isSyntheticPhone(phone)) {
    console.log('[SMS] skipped, load-test phone:', phone)
    return
  }
  if (isSmsBypassActive()) {
    // Message body is deliberately not logged: it carries OTPs.
    console.log('[SMS DEV] not sent (no provider credentials):', phone)
    return
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
  const json = await res.json() as { code?: number; message?: string }

  if (!res.ok || json.code !== 200) {
    throw new Error(json.message ?? 'SMS send failed')
  }
}
