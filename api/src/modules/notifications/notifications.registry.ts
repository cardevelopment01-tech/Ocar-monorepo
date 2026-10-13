// Every notification type that reaches a driver or rider, and how it is delivered. notifyOwner()
// fills in channel / TTL / collapse tag from here, so callers say WHAT happened and this file
// says HOW it is delivered. `type` on notifyOwner is typed as NotificationType, so an unregistered
// type fails to compile.
//
// channelId must match a channel the app creates at startup (apps/*-mobile/src/services/notifications).
// Android locks a channel's importance at creation, so changing one means a new id (…_v2).
// A type with no channelId lands on the app's `default_v2` channel.
//
// collapse: what a repeat push replaces on the device.
//   'ride_status' one slot per ride for status changes (arrived -> started -> completed...)
//   'ride_type'   one slot per ride + type (a second stop-added replaces the first)
//   'type'        one slot per type (wallet_low_balance never needs to stack)
//   'none'        every push is its own notification
export type Collapse = 'ride_status' | 'ride_type' | 'type' | 'none'

export interface NotificationTypeConfig {
  channelId?: string
  ttlSeconds: number
  collapse: Collapse
}

const HOUR = 3600
const DAY = 86_400

export const NOTIFICATION_TYPES = {
  // ── Ride lifecycle (rider) ──
  ride_accepted:     { channelId: 'ride_updates_v1', ttlSeconds: HOUR, collapse: 'ride_status' },
  driver_arrived:    { channelId: 'ride_updates_v1', ttlSeconds: 600, collapse: 'ride_status' },
  ride_started:      { channelId: 'ride_updates_v1', ttlSeconds: 600, collapse: 'ride_status' },
  ride_completed:    { channelId: 'ride_updates_v1', ttlSeconds: DAY, collapse: 'ride_status' },
  ride_no_drivers:   { channelId: 'ride_updates_v1', ttlSeconds: 1800, collapse: 'ride_status' },
  payment_failed:    { channelId: 'ride_updates_v1', ttlSeconds: DAY, collapse: 'ride_type' },
  stop_unreachable:  { channelId: 'ride_updates_v1', ttlSeconds: 1800, collapse: 'ride_type' },
  // ── Ride lifecycle (rider and driver) ──
  ride_cancelled:    { channelId: 'ride_updates_v1', ttlSeconds: HOUR, collapse: 'ride_status' },
  trip_window_ending: { channelId: 'ride_updates_v1', ttlSeconds: 1800, collapse: 'ride_type' },
  trip_window_ended:  { channelId: 'ride_updates_v1', ttlSeconds: 1800, collapse: 'ride_type' },
  // ── Ride lifecycle (driver) ──
  ride_manual_request: { channelId: 'ride_requests_v2', ttlSeconds: 30, collapse: 'ride_type' },
  ride_force_assigned: { channelId: 'ride_updates_v1', ttlSeconds: 60, collapse: 'ride_type' },
  stop_added:        { channelId: 'ride_updates_v1', ttlSeconds: 1800, collapse: 'ride_type' },
  pickup_updated:    { channelId: 'ride_updates_v1', ttlSeconds: 1800, collapse: 'ride_type' },
  // ── Driver account ──
  document_rejected: { channelId: 'account_alerts_v1', ttlSeconds: 7 * DAY, collapse: 'none' },
  document_expiring: { channelId: 'account_alerts_v1', ttlSeconds: 7 * DAY, collapse: 'none' },
  document_expired:  { channelId: 'account_alerts_v1', ttlSeconds: 7 * DAY, collapse: 'none' },
  profile_corrected: { channelId: 'account_alerts_v1', ttlSeconds: 7 * DAY, collapse: 'type' },
  vehicle_corrected: { channelId: 'account_alerts_v1', ttlSeconds: 7 * DAY, collapse: 'type' },
  account_suspended: { channelId: 'account_alerts_v1', ttlSeconds: 7 * DAY, collapse: 'type' },
  driver_warning:    { channelId: 'account_alerts_v1', ttlSeconds: 7 * DAY, collapse: 'none' },
  wallet_low_balance: { channelId: 'account_alerts_v1', ttlSeconds: DAY, collapse: 'type' },
  session_ended_stale: { ttlSeconds: HOUR, collapse: 'type' },
} as const satisfies Record<string, NotificationTypeConfig>

export type NotificationType = keyof typeof NOTIFICATION_TYPES

// Chat bypasses notifyOwner (no feed row) but still gets its own channel and a short life.
export const CHAT_PUSH = { channelId: 'chat_v1', ttlSeconds: HOUR } as const

export function pushDefaults(type: NotificationType, rideId?: bigint): { channelId?: string; ttlSeconds: number; tag?: string } {
  const cfg: NotificationTypeConfig = NOTIFICATION_TYPES[type]
  let tag: string | undefined
  if (cfg.collapse === 'ride_status' && rideId !== undefined) tag = `ride-${rideId}-status`
  else if (cfg.collapse === 'ride_type' && rideId !== undefined) tag = `ride-${rideId}-${type}`
  else if (cfg.collapse === 'type') tag = type
  return { ...(cfg.channelId !== undefined ? { channelId: cfg.channelId } : {}), ttlSeconds: cfg.ttlSeconds, ...(tag !== undefined ? { tag } : {}) }
}
