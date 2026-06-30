// FCM push provider — typed interface ready; delivery is a no-op until:
// 1. device_tokens migration is added to users/drivers tables
// 2. FCM service account key is added to config
// 3. Frontend SDK registers tokens on login

export interface PushPayload {
  token: string
  title: string
  body: string
  data?: Record<string, string>
}

export async function sendPush(payload: PushPayload): Promise<void> {
  if (process.env['NODE_ENV'] !== 'production') {
    console.log('[PUSH DEV]', { title: payload.title, body: payload.body })
  }
}
