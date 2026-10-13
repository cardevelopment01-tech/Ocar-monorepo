import * as repo from './notifications.repository'
import { sendPush, type PushMessage, type SendPushResult } from './providers/push.provider'
import { pushDefaults, type NotificationType } from './notifications.registry'
import { socketEvents } from '@/websocket/socket.server'
import type { NotifOwnerType } from './notifications.repository'
import { renderTemplate } from './templates.service'
import { logger } from '@/lib/logger'
import { client as redis } from '@/db/redis'
import { ridePushSentKey, rideEventPushKey } from '@/constants/redis-keys'

const log = logger.child({ module: 'notifications-service' })

// Re-exported unchanged so existing callers (e.g. the notifications worker,
// which uses `Parameters<typeof notifService.logNotification>[0]`) keep working.
export const logNotification = repo.logNotification
export const markSent = repo.markSent
export const markFailed = repo.markFailed

export async function pushToTokens(tokens: string[], msg: PushMessage): Promise<SendPushResult | null> {
  if (tokens.length === 0) return null
  try {
    const result = await sendPush(tokens, msg)
    if (result.invalidTokens.length > 0) {
      await repo.deleteDeviceTokens(result.invalidTokens)
    }
    return result
  } catch (err) {
    log.error({ err }, 'pushToTokens failed')
    return null
  }
}

// Fires at most ONE ride-request push per ride+driver, guarded by a Redis
// SET NX so a live-socket driver's later ack-check retries (or a caller that
// already push-notified them, e.g. a backgrounded broadcast match) never
// double-send. Shared by broadcast.processor.ts (immediate push for a
// backgrounded match) and ack-check.processor.ts (fallback push for a driver
// whose live socket emit never got acked).
export async function sendRideRequestPushOnce(
  rideId: string,
  driverId: string,
  pickup: string,
  drop: string,
  windowSeconds: number
): Promise<void> {
  const firstFire = await redis.set(
    ridePushSentKey(rideId, driverId), '1',
    'EX', windowSeconds + 30, 'NX'
  )
  if (firstFire !== 'OK') return

  try {
    const tokens = await repo.getTokensForOwner('driver', BigInt(driverId))
    await pushToTokens(tokens, {
      title: 'New ride request',
      body: `${pickup} → ${drop}`,
      tag: `ride-${rideId}`,
      ttlSeconds: Math.min(windowSeconds, 30),
      data: { type: 'ride_request', rideId },
      channelId: 'ride_requests_v2',
    })
  } catch (err) {
    log.error({ err }, 'sendRideRequestPushOnce failed')
  }
}

// Single entry point for anything that should reach an owner's in-app
// notification feed: persists the feed item, sends the OS push, and emits
// a live socket update so an already-open app updates without a refetch.
// Each leg is independent — a push/socket failure never blocks the others.
export async function notifyOwner(params: {
  ownerType: NotifOwnerType
  ownerId: bigint
  type: NotificationType
  title: string
  body: string
  payload?: Record<string, unknown>
  rideId?: bigint
  // Channel / TTL / collapse tag default from notifications.registry.ts; pass one only to
  // override it for this send (e.g. a per-document tag).
  tag?: string
  ttlSeconds?: number
  channelId?: string
}): Promise<void> {
  const item = await repo.createInAppNotification(params)
  const defaults = pushDefaults(params.type, params.rideId)
  const tag = params.tag ?? defaults.tag
  const channelId = params.channelId ?? defaults.channelId

  const job: PushJobData = {
    ownerType: params.ownerType,
    ownerId: params.ownerId.toString(),
    notificationId: item.id,
    msg: {
      title: params.title,
      body: params.body,
      // The payload contract every push carries (FCM data values must all be strings).
      data: {
        ...(params.payload as Record<string, string> | undefined),
        type: params.type,
        notificationId: item.id,
        sentAt: new Date().toISOString(),
        ...(params.rideId !== undefined ? { rideId: params.rideId.toString() } : {}),
      },
      ttlSeconds: params.ttlSeconds ?? defaults.ttlSeconds,
      ...(tag !== undefined ? { tag } : {}),
      ...(channelId !== undefined ? { channelId } : {}),
    },
  }

  try {
    // Queued so FCM latency/outages never sit on the request path, and the worker retries.
    const { pushQueue } = await import('@/jobs/queues')
    await pushQueue.add('push_send', job, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })
  } catch (err) {
    // Queue (Redis) unavailable: send inline rather than lose the push.
    log.error({ err }, 'push enqueue failed, sending inline')
    try {
      await deliverPush(job)
    } catch (sendErr) {
      log.error({ err: sendErr }, 'notify push leg failed')
    }
  }

  try {
    socketEvents.sendNotification(params.ownerType, params.ownerId.toString(), item)
  } catch (err) {
    log.error({ err }, 'notify socket leg failed')
  }
}

export interface PushJobData {
  ownerType: NotifOwnerType
  ownerId: string
  notificationId: string
  msg: PushMessage
}

// Resolves the owner's tokens at send time (not enqueue time, so a token registered in between
// still gets it) and sends. Used by the push worker and the inline fallback above.
export async function deliverPush(job: PushJobData): Promise<SendPushResult | null> {
  const tokens = await repo.getTokensForOwner(job.ownerType, BigInt(job.ownerId))
  return pushToTokens(tokens, job.msg)
}

// Admin notifications go to every admin (ops team), not one owner — persists
// one feed row per admin so each admin's read state is independent, but
// pushes/sockets go out once for the whole team.
export async function notifyAllAdmins(params: {
  type: string
  title: string
  body: string
  payload?: Record<string, unknown>
  rideId?: bigint
  // Restrict to active admins with these roles (daily digest). When set, the shared
  // `admin:ops` socket room is skipped: it reaches every admin, so it would leak content
  // meant for a role subset. Omitted = every admin, socket included (unchanged).
  roles?: string[]
}): Promise<void> {
  const { roles, ...rest } = params
  const adminIds = await repo.getAllAdminIds(roles)
  await Promise.all(adminIds.map(id => repo.createInAppNotification({ ownerType: 'admin', ownerId: id, ...rest })))

  try {
    const tokens = await repo.getAdminTokens(roles)
    await pushToTokens(tokens, {
      title: params.title,
      body: params.body,
      data: { type: params.type, ...(params.rideId !== undefined ? { rideId: params.rideId.toString() } : {}) },
    })
  } catch (err) {
    log.error({ err }, 'notify admin push leg failed')
  }

  if (roles) return

  try {
    socketEvents.sendNotification('admin', '', {
      type: params.type,
      title: params.title,
      body: params.body,
      payload: params.payload ?? {},
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    log.error({ err }, 'notify admin socket leg failed')
  }
}

// Ride lifecycle events that used to reach the app only over the socket, so a backgrounded
// app never heard them. `slug` is the notification_templates row (editable in admin); the
// title/body here are the fallback if that row is missing or inactive.
const RIDE_EVENTS = {
  driver_arrived: { ownerType: 'user', type: 'driver_arrived', title: 'Your driver has arrived', body: 'Your driver is at the pickup point. Share your OTP to start the trip.' },
  ride_started: { ownerType: 'user', type: 'ride_started', title: 'Trip started', body: 'Your trip is under way. Have a safe ride.' },
  ride_cancelled_by_driver: { ownerType: 'user', type: 'ride_cancelled', title: 'Ride cancelled', body: 'Your driver cancelled the ride. You can book another cab.' },
  ride_cancelled_by_system: { ownerType: 'user', type: 'ride_cancelled', title: 'Ride cancelled', body: "Your driver didn't arrive in time, so the ride was cancelled. Please book again." },
  ride_no_drivers: { ownerType: 'user', type: 'ride_no_drivers', title: 'No drivers found', body: 'We could not find a driver nearby. Please try again.' },
  ride_cancelled_by_rider: { ownerType: 'driver', type: 'ride_cancelled', title: 'Ride cancelled', body: 'The rider cancelled this ride.' },
  ride_cancelled_timeout: { ownerType: 'driver', type: 'ride_cancelled', title: 'Ride cancelled', body: 'This ride was cancelled because you did not arrive in time.' },
} as const
export type RideEventSlug = keyof typeof RIDE_EVENTS

// Fire-and-forget by design: never throws, so a notification problem can't fail the ride
// transition that triggered it. At most one push per ride + recipient + event (a retried
// status call, e.g. a double-tapped "arrived", must not notify twice).
export async function notifyRideEvent(slug: RideEventSlug, ownerId: bigint, rideId: bigint): Promise<void> {
  try {
    const event = RIDE_EVENTS[slug]
    const first = await redis.set(rideEventPushKey(rideId.toString(), slug, ownerId.toString()), '1', 'EX', 86_400, 'NX')
    if (first !== 'OK') return

    let title: string = event.title
    let body: string = event.body
    try {
      const rendered = await renderTemplate(slug, 'push', {})
      title = rendered.subject ?? title
      body = rendered.body
    } catch {
      // template missing/inactive -- fall back to the built-in copy above
    }
    await notifyOwner({
      ownerType: event.ownerType,
      ownerId,
      type: event.type,
      title,
      body,
      rideId,
    })
  } catch (err) {
    log.error({ err, slug, rideId: rideId.toString() }, 'notifyRideEvent failed')
  }
}

export const listNotifications = repo.listNotifications
export const getUnreadCount = repo.getUnreadCount
export const markRead = repo.markRead
export const markAllRead = repo.markAllRead

// Proactive "your ride payment didn't go through" notification. Renders the
// payment_failed push template and hands off to notifyOwner (in-app feed +
// push + socket). Called from the two ride-payment failure sites:
// reconcilePendingRidePayments (online) and settleRideCompletionPayment (wallet).
export async function notifyRidePaymentFailed(
  userId: bigint,
  rideId: bigint,
  amount: number
): Promise<void> {
  const { subject, body } = await renderTemplate('payment_failed', 'push', {
    amount: String(Math.round(amount)),
  })
  await notifyOwner({
    ownerType: 'user',
    ownerId: userId,
    type: 'payment_failed',
    title: subject ?? 'Payment failed',
    body,
    rideId,
  })
}

// Driver's wallet dropped below the minimum required to receive rides after
// a commission deduction. Called from deductCommission (payments.service.ts).
export async function notifyDriverLowWalletBalance(
  driverId: bigint,
  balance: number,
  minBalance: number
): Promise<void> {
  const { subject, body } = await renderTemplate('wallet_low_balance', 'push', {
    balance: String(balance),
    minBalance: String(minBalance),
  })
  await notifyOwner({
    ownerType: 'driver',
    ownerId: driverId,
    type: 'wallet_low_balance',
    title: subject ?? 'Wallet balance low',
    body,
    payload: { path: '/wallet' },
  })
}

// Staged reminder for an approved document nearing its valid_until date.
// Called from the daily sweep_document_expiry scheduler job.
export async function notifyDocumentExpiring(
  driverId: bigint,
  docLabel: string,
  daysRemaining: number,
  route: 'documents' | 'vehicle-docs'
): Promise<void> {
  const { subject, body } = await renderTemplate('document_expiring', 'push', {
    docLabel,
    daysRemaining: String(daysRemaining),
  })
  await notifyOwner({
    ownerType: 'driver',
    ownerId: driverId,
    type: 'document_expiring',
    title: subject ?? 'Document expiring soon',
    body,
    payload: { path: '/profile/documents' },
    tag: `document_expiring:${route}:${docLabel}`,
  })
}

// Fired once a document's valid_until has passed. hasApprovedRequiredDocs()
// already blocks goOnline() for this driver the moment this is true — this
// is the notification half, not the enforcement.
export async function notifyDocumentExpired(
  driverId: bigint,
  docLabel: string,
  route: 'documents' | 'vehicle-docs'
): Promise<void> {
  const { subject, body } = await renderTemplate('document_expired', 'push', { docLabel })
  await notifyOwner({
    ownerType: 'driver',
    ownerId: driverId,
    type: 'document_expired',
    title: subject ?? 'Document expired',
    body,
    payload: { path: '/profile/documents' },
    tag: `document_expired:${route}:${docLabel}`,
  })
}
