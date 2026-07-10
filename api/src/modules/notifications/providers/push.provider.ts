// FCM push provider — guarded exactly like sms.provider.ts:
// no service-account configured => dev-log no-op, never throws.
import { initializeApp, cert, getApps, getApp, type App, type ServiceAccount } from 'firebase-admin/app'
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging'
import { config } from '@/config'

export interface PushMessage {
  title: string
  body: string
  data?: Record<string, string>
}

export interface SendPushResult {
  invalidTokens: string[]
}

let firebaseApp: App | null = null
let initAttempted = false

function getFirebaseApp(): App | null {
  if (initAttempted) return firebaseApp
  initAttempted = true

  if (!config.FCM_SERVICE_ACCOUNT_KEY) {
    return null
  }

  try {
    const serviceAccount = JSON.parse(config.FCM_SERVICE_ACCOUNT_KEY) as ServiceAccount
    firebaseApp = getApps().length ? getApp() : initializeApp({ credential: cert(serviceAccount) })
    return firebaseApp
  } catch (err) {
    console.error('[PUSH] Failed to initialize FCM — push disabled:', err instanceof Error ? err.message : 'unknown error')
    firebaseApp = null
    return null
  }
}

export async function sendPush(tokens: string[], msg: PushMessage): Promise<SendPushResult> {
  if (tokens.length === 0) {
    return { invalidTokens: [] }
  }

  if (!config.FCM_SERVICE_ACCOUNT_KEY) {
    console.log('[PUSH DEV]', { tokens: tokens.length, title: msg.title, body: msg.body })
    return { invalidTokens: [] }
  }

  const fbApp = getFirebaseApp()
  if (!fbApp) {
    return { invalidTokens: [] }
  }

  try {
    const message: MulticastMessage = {
      tokens,
      notification: { title: msg.title, body: msg.body },
    }
    if (msg.data) message.data = msg.data

    const response = await getMessaging(fbApp).sendEachForMulticast(message)

    const invalidTokens: string[] = []
    response.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
          const badToken = tokens[i]
          if (badToken) invalidTokens.push(badToken)
        }
      }
    })

    return { invalidTokens }
  } catch (err) {
    console.error('[PUSH] sendEachForMulticast failed:', err instanceof Error ? err.message : 'unknown error')
    return { invalidTokens: [] }
  }
}
