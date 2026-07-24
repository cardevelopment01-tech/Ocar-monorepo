import { config } from '@/config'

export async function sendSms(phone: string, message: string, templateId?: string): Promise<void> {
  if (!config.BULKSMSPLANS_API_ID || !config.BULKSMSPLANS_API_PASSWORD) {
    console.log('[SMS DEV]', phone, message)
    return
  }

  const stripped = phone.replace(/^\+?91/, '')

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
