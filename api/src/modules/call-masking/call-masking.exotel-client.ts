import { config } from '@/config'

export interface ConnectCallParams {
  from: string
  to: string
  callerId: string
  timeLimitSeconds: number
  waitAudioUrl?: string
  statusCallbackUrl?: string
  customField?: string
}

export interface ConnectCallResult {
  sid: string
  status: string
}

export async function connectTwoNumbers(params: ConnectCallParams): Promise<ConnectCallResult> {
  const url = `https://${config.EXOTEL_SUBDOMAIN}/v1/Accounts/${config.EXOTEL_SID}/Calls/connect.json`
  const auth = Buffer.from(`${config.EXOTEL_API_KEY}:${config.EXOTEL_API_TOKEN}`).toString('base64')

  const body = new URLSearchParams({
    From: params.from,
    To: params.to,
    CallerId: params.callerId,
    TimeLimit: String(params.timeLimitSeconds),
  })
  if (params.waitAudioUrl) body.set('WaitUrl', params.waitAudioUrl)
  if (params.statusCallbackUrl) body.set('StatusCallback', params.statusCallbackUrl)
  if (params.customField) body.set('CustomField', params.customField)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  const json = await res.json() as { Call?: { Sid: string; Status: string }; RestException?: { Message: string } }
  if (!res.ok || !json.Call) {
    throw new Error(json.RestException?.Message ?? 'Exotel call failed')
  }
  return { sid: json.Call.Sid, status: json.Call.Status }
}
