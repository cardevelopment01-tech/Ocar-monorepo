import * as repo from './notifications.repository'
import { sendPush, type PushMessage } from './providers/push.provider'

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
