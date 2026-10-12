import { config } from '@/config'

// True when messages are NOT really sent (no vendor credentials). In production this only happens when
// ALLOW_DEV_SMS=true was set deliberately, and server.ts logs a warning at boot so it can't go unnoticed.
export function isSmsBypassActive(): boolean {
  return !config.BULKSMSPLANS_API_ID || !config.BULKSMSPLANS_API_PASSWORD
}

export async function sendSms(phone: string, message: string, templateId?: string): Promise<void> {
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
