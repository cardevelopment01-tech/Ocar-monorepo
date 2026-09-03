import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { loginUser, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'

const app = createApp()

const PHONES = { notifUser: '+919700000201' } as const

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...Object.values(PHONES)])
  await redis.del(`otp_rate:user:${PHONES.notifUser}:login`)
  await redis.del(`otp:user:${PHONES.notifUser}:login`)
  await pool.end()
  redis.disconnect()
})

describe('M10 — Notifications', () => {
  describe('Device tokens and in-app feed', () => {
    it('TC-M10-001: device token register/unregister round trip', async () => {
      const { accessToken, userId } = await loginUser(app, redis, PHONES.notifUser)

      try {
        const registerRes = await request(app)
          .post('/api/v1/notifications/devices')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ token: 'test-fcm-token-abc123', platform: 'android' })
        expect(registerRes.status, JSON.stringify(registerRes.body)).toBe(204)

        const { rows } = await pool.query(
          `SELECT owner_type, owner_id, platform FROM device_tokens WHERE token = 'test-fcm-token-abc123'`
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.owner_type).toBe('user')
        expect(String(rows[0]?.owner_id)).toBe(String(userId))

        const unregisterRes = await request(app)
          .delete('/api/v1/notifications/devices')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ token: 'test-fcm-token-abc123' })
        expect(unregisterRes.status, JSON.stringify(unregisterRes.body)).toBe(204)

        const { rows: afterRows } = await pool.query(
          `SELECT * FROM device_tokens WHERE token = 'test-fcm-token-abc123'`
        )
        expect(afterRows).toHaveLength(0)
      } finally {
        await pool.query(`DELETE FROM device_tokens WHERE token = 'test-fcm-token-abc123'`)
      }
    })

    it('TC-M10-002: notifyOwner persists a real in-app feed row visible via the API', async () => {
      const { accessToken, userId } = await loginUser(app, redis, PHONES.notifUser)

      try {
        const { notifyOwner } = await import('@/modules/notifications/notifications.service')
        await notifyOwner({
          ownerType: 'user', ownerId: BigInt(userId), type: 'test_notification',
          title: 'Test', body: 'This is a test notification',
        })

        const unreadRes = await request(app)
          .get('/api/v1/notifications/unread-count')
          .set('Authorization', `Bearer ${accessToken}`)
        expect(unreadRes.status, JSON.stringify(unreadRes.body)).toBe(200)
        expect(unreadRes.body.count).toBeGreaterThanOrEqual(1)

        const listRes = await request(app)
          .get('/api/v1/notifications')
          .set('Authorization', `Bearer ${accessToken}`)
        expect(listRes.status, JSON.stringify(listRes.body)).toBe(200)
        expect(listRes.body.items.length).toBeGreaterThanOrEqual(1)
        const item = listRes.body.items.find((i: { type: string }) => i.type === 'test_notification')
        expect(item).toBeTruthy()

        const markReadRes = await request(app)
          .patch(`/api/v1/notifications/${item.id}/read`)
          .set('Authorization', `Bearer ${accessToken}`)
        expect(markReadRes.status, JSON.stringify(markReadRes.body)).toBe(204)

        // Marking the same (now-read) notification again must 404, not silently succeed.
        const markReadAgainRes = await request(app)
          .patch(`/api/v1/notifications/${item.id}/read`)
          .set('Authorization', `Bearer ${accessToken}`)
        expect(markReadAgainRes.status).toBe(404)

        const readAllRes = await request(app)
          .post('/api/v1/notifications/read-all')
          .set('Authorization', `Bearer ${accessToken}`)
        expect(readAllRes.status, JSON.stringify(readAllRes.body)).toBe(204)

        const finalUnreadRes = await request(app)
          .get('/api/v1/notifications/unread-count')
          .set('Authorization', `Bearer ${accessToken}`)
        expect(finalUnreadRes.body.count).toBe(0)
      } finally {
        await pool.query(`DELETE FROM notification_logs WHERE owner_type='user' AND owner_id=$1`, [userId])
      }
    })

    // Deferred — no voice-call provider exists anywhere in api/src. The
    // notif_channel enum includes 'voice' but nothing sends via it.
    it.todo('TC-M10-003: SOS triggers voice call to emergency contact — no voice provider implemented')

    // Deferred — this describes retry/backoff behavior in the async BullMQ
    // worker delivery path (notifications.worker.ts), not any HTTP surface
    // this plan tests. Out of scope for the HTTP-integration-test shape used
    // throughout this plan; would need a worker-level test harness instead.
    it.todo('TC-M10-004: notification failure retries with exponential backoff — worker-level behavior, not HTTP-testable here')
  })

  // TC-M10-005 (template rendering) is Task 8's job — see the "Admin
  // notification templates" describe block added there.
})
