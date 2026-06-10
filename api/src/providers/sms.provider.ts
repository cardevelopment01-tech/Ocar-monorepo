import { config } from '@/config'

export async function sendSms(phone: string, message: string): Promise<void> {
  if (!config.FAST2SMS_API_KEY) {
    console.log('[SMS DEV]', phone, message)
    return
  }

  const stripped = phone.replace(/^\+?91/, '')

  const url = new URL('https://www.fast2sms.com/dev/bulkV2')
  url.searchParams.set('authorization', config.FAST2SMS_API_KEY)
  url.searchParams.set('route', 'q')
  url.searchParams.set('message', message)
  url.searchParams.set('language', 'english')
  url.searchParams.set('flash', '0')
  url.searchParams.set('numbers', stripped)

  const res = await fetch(url.toString())
  const json = await res.json() as { return?: boolean; message?: string[] | string }

  if (!res.ok || json.return === false) {
    const detail = Array.isArray(json.message)
      ? json.message.join(', ')
      : (json.message ?? 'SMS send failed')
    throw new Error(detail)
  }
}
