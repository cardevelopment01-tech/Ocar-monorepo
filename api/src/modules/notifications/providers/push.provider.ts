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
  // `tag` collapses repeat pushes into one notification (Android collapseKey + notification
  // tag, APNs collapse-id, webpush tag/renotify). `ttlSeconds` is how long FCM may hold the
  // message for an offline device before dropping it.
  tag?: string
  ttlSeconds?: number
  // Routes the notification to a client-configured Android channel (see
  // registerPushNotifications.ts) -- e.g. driver-mobile's high-importance
  // 'ride_requests_v2' channel. Falls back to 'default_v2', which every app creates.
  channelId?: string
}

export interface SendPushResult {
  invalidTokens: string[]
  successCount: number
  failureCount: number
  // FCM/network trouble that a later attempt could fix (as opposed to a dead token, which a
  // retry never will). Only meaningful to a caller that can retry, i.e. the push worker.
  transientFailure: boolean
}

const NOTHING_SENT: SendPushResult = { invalidTokens: [], successCount: 0, failureCount: 0, transientFailure: false }

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
    return NOTHING_SENT
  }

  if (!config.FCM_SERVICE_ACCOUNT_KEY) {
    console.log('[PUSH DEV]', { tokens: tokens.length, title: msg.title, body: msg.body })
    return NOTHING_SENT
  }

  const fbApp = getFirebaseApp()
  if (!fbApp) {
    return NOTHING_SENT
  }

  try {
    // Android notification.sound/channelId/defaultVibrateTimings were previously
    // never set here -- with no channelId, Android routes the notification to
    // its own auto-created fallback channel instead of whichever channel the
    // client actually configured with sound + vibration (registerPushNotifications.ts),
    // which is why notifications arrived silently despite the client-side channel
    // setup being correct. Set on every push, not just tagged ones.
    const androidNotification: NonNullable<NonNullable<MulticastMessage['android']>['notification']> = {
      channelId: msg.channelId ?? 'default_v2',
      sound: 'default',
      defaultVibrateTimings: true,
    }
    const android: NonNullable<MulticastMessage['android']> = { priority: 'high', notification: androidNotification }
    // ttl/collapseKey/tag were previously only written to the webpush block, so on Android a
    // "30 s" ride-request push lived for FCM's default 4 weeks and repeat pushes stacked.
    // ttl is milliseconds in the Admin SDK.
    if (msg.ttlSeconds !== undefined) android.ttl = msg.ttlSeconds * 1000
    if (msg.tag) {
      android.collapseKey = msg.tag
      androidNotification.tag = msg.tag
    }
    // iOS (planned): same intent via APNs headers; harmless for Android tokens in the same multicast.
    const apnsHeaders: Record<string, string> = { 'apns-priority': '10' }
    if (msg.ttlSeconds !== undefined) apnsHeaders['apns-expiration'] = String(Math.floor(Date.now() / 1000) + msg.ttlSeconds)
    if (msg.tag) apnsHeaders['apns-collapse-id'] = msg.tag.slice(0, 64)
    const message: MulticastMessage = {
      tokens,
      notification: { title: msg.title, body: msg.body },
      android,
      apns: { headers: apnsHeaders, payload: { aps: { sound: 'default' } } },
    }
    if (msg.data) message.data = msg.data
    if (msg.tag) {
      const headers: Record<string, string> = { Urgency: 'high' }
      if (msg.ttlSeconds !== undefined) headers['TTL'] = String(msg.ttlSeconds)
      message.webpush = {
        headers,
        notification: { tag: msg.tag, renotify: true },
      }
    }

    const response = await getMessaging(fbApp).sendEachForMulticast(message)

    const invalidTokens: string[] = []
    let transientFailure = false
    response.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
          const badToken = tokens[i]
          if (badToken) invalidTokens.push(badToken)
        } else {
          transientFailure = true
        }
      }
    })

    return { invalidTokens, successCount: response.successCount ?? 0, failureCount: response.failureCount ?? 0, transientFailure }
  } catch (err) {
    log.error({ err }, 'sendEachForMulticast failed')
    return { invalidTokens: [], successCount: 0, failureCount: tokens.length, transientFailure: true }
  }
}
