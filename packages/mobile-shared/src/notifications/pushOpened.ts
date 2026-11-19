import type { AxiosInstance } from 'axios'

/**
 * Opening a notification counts as reading it: this is what the admin's "Opened" number for a broadcast is made of. Every push
 * from the server carries the person's own `notificationId`. Best-effort and silent: a failed call must never get in the way of
 * the screen the tap opens. Resolves true when it asked the server, false when the push had no id.
 */
export async function markPushOpened(api: Pick<AxiosInstance, 'patch'>, data: Record<string, string> | undefined): Promise<boolean> {
  const id = data?.['notificationId']
  // Only digits: the id goes into a URL path, and the data came from a push payload.
  if (!id || !/^\d{1,19}$/.test(id)) return false
  try {
    await api.patch(`/api/v1/notifications/${id}/read`)
  } catch {
    // Already read, or offline: nothing to do.
  }
  return true
}
