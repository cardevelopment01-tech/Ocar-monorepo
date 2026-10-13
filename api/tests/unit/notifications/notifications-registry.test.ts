import { describe, it, expect } from 'vitest'
import { NOTIFICATION_TYPES, pushDefaults, CHAT_PUSH, type NotificationType } from '@/modules/notifications/notifications.registry'

// Channel ids the apps create at startup (apps/*-mobile/src/services/notifications/index.ts).
// Keep in sync: a push to a channel the app never created falls back to FCM's own default channel
// (no heads-up, no custom sound).
const APP_CHANNELS = new Set(['default_v2', 'ride_requests_v2', 'ride_updates_v1', 'chat_v1', 'account_alerts_v1', 'announcements_v1', 'offers_v1'])

describe('notification registry', () => {
  it('only targets channels the apps create', () => {
    for (const [type, cfg] of Object.entries(NOTIFICATION_TYPES) as [NotificationType, { channelId?: string }][]) {
      if (cfg.channelId) expect(APP_CHANNELS, type).toContain(cfg.channelId)
    }
    expect(APP_CHANNELS).toContain(CHAT_PUSH.channelId)
  })

  it('every type has a positive TTL', () => {
    for (const cfg of Object.values(NOTIFICATION_TYPES)) expect(cfg.ttlSeconds).toBeGreaterThan(0)
  })

  it('ride status changes share one slot per ride; per-event types get their own', () => {
    expect(pushDefaults('driver_arrived', 5n).tag).toBe('ride-5-status')
    expect(pushDefaults('ride_cancelled', 5n).tag).toBe('ride-5-status')
    expect(pushDefaults('stop_added', 5n).tag).toBe('ride-5-stop_added')
    expect(pushDefaults('wallet_low_balance').tag).toBe('wallet_low_balance')
    expect(pushDefaults('document_rejected').tag).toBeUndefined()
  })

  it('a ride-scoped type without a ride id gets no tag instead of "ride-undefined"', () => {
    expect(pushDefaults('driver_arrived').tag).toBeUndefined()
  })

  it('ride requests the driver must answer expire with the dispatch window', () => {
    expect(NOTIFICATION_TYPES.ride_manual_request.ttlSeconds).toBeLessThanOrEqual(30)
  })
})
