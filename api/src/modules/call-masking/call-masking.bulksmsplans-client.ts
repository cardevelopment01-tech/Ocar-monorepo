import { config } from '@/config'

// Mirrors sms.provider.ts's request shape — same vendor, same api_id/password,
// different product endpoint. bulksmsplans expects a bare 10-digit local
// number, not E.164, so a +91/91 country code is stripped first. Only strips
// when there are actually more than 10 digits left afterwards — a bare
// `/^\+?91/` would also match (and corrupt) a valid 10-digit number that
// happens to start with "91", e.g. 9123456789.
function toLocalNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits
}

const REQUEST_TIMEOUT_MS = 8000

export async function makeCall(params: {
  receiverNumber: string
  agentNumber: string
  dial: 'Agent' | 'Customer'
}): Promise<void> {
  const body = {
    api_id: config.BULKSMSPLANS_API_ID,
    api_password: config.BULKSMSPLANS_API_PASSWORD,
    ivr_number: config.BULKSMSPLANS_IVR_NUMBER,
    dial: params.dial,
    receiver_number: toLocalNumber(params.receiverNumber),
    agent_number: toLocalNumber(params.agentNumber),
  }

  const res = await fetch('https://www.bulksmsplans.com/api/ivr/makeACall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const json = await res.json() as { code?: number; message?: string }

  if (!res.ok || json.code !== 200) {
    throw new Error(json.message ?? 'IVR makeACall failed')
  }
}

export async function checkCredit(): Promise<number> {
  const params = new URLSearchParams({
    api_id: config.BULKSMSPLANS_API_ID,
    api_password: config.BULKSMSPLANS_API_PASSWORD,
    ivr_number: config.BULKSMSPLANS_IVR_NUMBER,
  })
  const res = await fetch(`https://www.bulksmsplans.com/api/ivr/check_ivr_credit?${params.toString()}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const json = await res.json() as { success?: boolean; ivr_credit?: number | string }

  const credit = Number(json.ivr_credit)
  if (!res.ok || !json.success || json.ivr_credit === undefined || !Number.isFinite(credit)) {
    throw new Error('IVR check_ivr_credit failed')
  }
  return credit
}
