// FCM push provider — guarded exactly like sms.provider.ts:
// no service-account configured => dev-log no-op, never throws.
import { initializeApp, cert, getApps, getApp, type App, type ServiceAccount } from 'firebase-admin/app'
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging'
import { config } from '@/config'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'push-provider' })

export interface PushMessage {
  title: string
  body: string
  data?: Record<string, string>
  // Set together, only by the ride-request fallback push (ack-check.processor.ts) —
  // `tag` collapses repeat pushes for the same ride into one notification via
  // the browser's native tag/renotify behavior instead of stacking popups.
  tag?: string
  ttlSeconds?: number
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
    log.error({ err }, 'failed to initialize FCM — push disabled')
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
    if (msg.tag) {
      message.android = { priority: 'high' }
      const headers: Record<string, string> = { Urgency: 'high' }
      if (msg.ttlSeconds !== undefined) headers['TTL'] = String(msg.ttlSeconds)
      message.webpush = {
        headers,
        notification: { tag: msg.tag, renotify: true },
      }
    }

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
    log.error({ err }, 'sendEachForMulticast failed')
    return { invalidTokens: [] }
  }
}
