import { useSyncExternalStore } from 'react'

// Shape of GET /api/v1/notifications items and the `notification:new` socket event.
export type NotificationFeedItem = {
  id: string
  type: string
  title: string | null
  body: string
  payload?: Record<string, unknown>
  rideId: string | null
  readAt: string | null
  createdAt: string
}

export type NotificationGroup = 'rides' | 'payments' | 'account' | 'other'

const RIDE_TYPES = new Set([
  'ride_accepted', 'driver_arrived', 'ride_started', 'ride_completed', 'ride_cancelled', 'ride_no_drivers',
  'ride_force_assigned', 'ride_manual_request', 'stop_added', 'stop_unreachable', 'pickup_updated',
  'trip_window_ending', 'trip_window_ended',
])
const PAYMENT_TYPES = new Set(['payment_failed', 'wallet_low_balance'])
const ACCOUNT_TYPES = new Set([
  'document_rejected', 'document_expiring', 'document_expired', 'profile_corrected', 'vehicle_corrected',
  'account_suspended', 'driver_warning', 'session_ended_stale',
])
// Shown in the error colour: something the user probably has to act on.
const URGENT_TYPES = new Set([
  'payment_failed', 'document_rejected', 'document_expired', 'account_suspended', 'driver_warning',
  'ride_cancelled', 'ride_no_drivers', 'stop_unreachable',
])

export function notificationGroup(type: string): NotificationGroup {
  if (RIDE_TYPES.has(type)) return 'rides'
  if (PAYMENT_TYPES.has(type)) return 'payments'
  if (ACCOUNT_TYPES.has(type)) return 'account'
  return 'other'
}

export function isUrgentNotification(type: string): boolean {
  return URGENT_TYPES.has(type)
}

// How a row looks: one Feather glyph per type and a tint per kind of news (urgent wins over the group tint).
export type NotificationTone = 'ride' | 'money' | 'account' | 'promo' | 'urgent'

const TYPE_ICON: Record<string, string> = {
  ride_accepted: 'check-circle', driver_arrived: 'map-pin', ride_started: 'navigation', ride_completed: 'flag',
  ride_cancelled: 'x-circle', ride_no_drivers: 'search', ride_force_assigned: 'user-check', ride_manual_request: 'bell',
  stop_added: 'plus-circle', stop_unreachable: 'alert-triangle', pickup_updated: 'map-pin',
  trip_window_ending: 'clock', trip_window_ended: 'clock',
  payment_failed: 'credit-card', wallet_low_balance: 'credit-card',
  document_rejected: 'file-text', document_expiring: 'file-text', document_expired: 'file-text',
  profile_corrected: 'user', vehicle_corrected: 'truck', account_suspended: 'shield-off', driver_warning: 'alert-triangle',
  session_ended_stale: 'power', announcement: 'volume-2', offer: 'gift',
}

export function notificationIcon(type: string): string {
  return TYPE_ICON[type] ?? 'bell'
}

export function notificationTone(type: string): NotificationTone {
  if (isUrgentNotification(type)) return 'urgent'
  if (type === 'announcement' || type === 'offer') return 'promo'
  const group = notificationGroup(type)
  return group === 'rides' ? 'ride' : group === 'payments' ? 'money' : 'account'
}

// ── Unread count (one store per app, read by every bell/badge) ──

let unread = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setUnreadCount(n: number): void {
  const next = Math.max(0, n)
  if (next === unread) return
  unread = next
  listeners.forEach((l) => l())
}

export function getUnreadCount(): number {
  return unread
}

export function subscribeUnreadCount(listener: () => void): () => void {
  return subscribe(listener)
}

export function bumpUnreadCount(delta: number): void {
  setUnreadCount(unread + delta)
}

export function useUnreadCount(): number {
  return useSyncExternalStore(subscribe, () => unread, () => 0)
}

