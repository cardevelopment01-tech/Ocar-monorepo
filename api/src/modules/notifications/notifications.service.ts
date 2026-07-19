import * as repo from './notifications.repository'
import { sendPush, type PushMessage } from './providers/push.provider'
import { socketEvents } from '@/websocket/socket.server'
import type { NotifOwnerType } from './notifications.repository'
import { renderTemplate } from './templates.service'

// Re-exported unchanged so existing callers (e.g. the notifications worker,
// which uses `Parameters<typeof notifService.logNotification>[0]`) keep working.
export const logNotification = repo.logNotification
export const markSent = repo.markSent
export const markFailed = repo.markFailed

export async function pushToTokens(tokens: string[], msg: PushMessage): Promise<void> {
  if (tokens.length === 0) return
  try {
    const { invalidTokens } = await sendPush(tokens, msg)
    if (invalidTokens.length > 0) {
      await repo.deleteDeviceTokens(invalidTokens)
    }
  } catch (err) {
    console.error('[PUSH] pushToTokens failed:', err instanceof Error ? err.message : 'unknown error')
  }
}

// Single entry point for anything that should reach an owner's in-app
// notification feed: persists the feed item, sends the OS push, and emits
// a live socket update so an already-open app updates without a refetch.
// Each leg is independent — a push/socket failure never blocks the others.
export async function notifyOwner(params: {
  ownerType: NotifOwnerType
  ownerId: bigint
  type: string
  title: string
  body: string
  payload?: Record<string, unknown>
  rideId?: bigint
}): Promise<void> {
  const item = await repo.createInAppNotification(params)

  try {
    const tokens = await repo.getTokensForOwner(params.ownerType, params.ownerId)
    await pushToTokens(tokens, {
      title: params.title,
      body: params.body,
      data: { type: params.type, ...(params.rideId !== undefined ? { rideId: params.rideId.toString() } : {}) },
    })
  } catch (err) {
    console.error('[NOTIFY] push leg failed:', err instanceof Error ? err.message : 'unknown error')
  }

  try {
    socketEvents.sendNotification(params.ownerType, params.ownerId.toString(), item)
  } catch (err) {
    console.error('[NOTIFY] socket leg failed:', err instanceof Error ? err.message : 'unknown error')
  }
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
}): Promise<void> {
  const adminIds = await repo.getAllAdminIds()
  await Promise.all(adminIds.map(id => repo.createInAppNotification({ ownerType: 'admin', ownerId: id, ...params })))

  try {
    const tokens = await repo.getAdminTokens()
    await pushToTokens(tokens, {
      title: params.title,
      body: params.body,
      data: { type: params.type, ...(params.rideId !== undefined ? { rideId: params.rideId.toString() } : {}) },
    })
  } catch (err) {
    console.error('[NOTIFY] admin push leg failed:', err instanceof Error ? err.message : 'unknown error')
  }

  try {
    socketEvents.sendNotification('admin', '', {
      type: params.type,
      title: params.title,
      body: params.body,
      payload: params.payload ?? {},
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[NOTIFY] admin socket leg failed:', err instanceof Error ? err.message : 'unknown error')
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
