import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import {
  loginUser, setupOnlineDriver, cleanupRideAndDriverData, DEFAULT_BOOKING, driveRideToCompletion,
} from '../helpers/fixtures/rides.fixture'

// Real order-creation flow (payments.service.ts::createRidePaymentOrder) only takes
// the "create a Razorpay order and leave the payment pending" path when RAZORPAY_KEY_ID
// / RAZORPAY_KEY_SECRET are configured (see .env) — with them unset it auto-confirms the
// payment immediately in dev mode and never touches the webhook path at all. So we
// configure real-looking keys and mock the 'razorpay' SDK itself (same pattern as
// mocking '@/lib/storage' in m07.test.ts) rather than hitting the network.
vi.mock('razorpay', () => ({
  default: vi.fn().mockImplementation(() => ({
    orders: {
      create: vi.fn().mockImplementation((opts: { receipt: string }) =>
        Promise.resolve({ id: `order_test_${opts.receipt}` })
      ),
    },
  })),
}))

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()
const WEBHOOK_SECRET = process.env['RAZORPAY_WEBHOOK_SECRET']

const PHONES = {
  payer: '+919700000021',
  onlineDriver: '+919700000022',
  walletSufficient: '+919700000031',
  walletInsufficient: '+919700000032',
  walletDriverSufficient: '+919700000033',
  walletDriverInsufficient: '+919700000034',
  cashPayer: '+919700000041',
  cashDriver: '+919700000042',
  retryPayer: '+919700000043',
  retryDriver: '+919700000044',
  autoSettlePayer: '+919700000045',
  autoSettleDriver: '+919700000046',
  cashbackPayer: '+919700000047',
  cashbackDriver: '+919700000048',
} as const

let categoryId: number

beforeAll(async () => {
  if (!WEBHOOK_SECRET) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET must be set in the test environment for M08 webhook tests')
  }
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1"
  )
  categoryId = Number(rows[0]!.id)
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...Object.values(PHONES)])
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp_rate:driver:${p}:login`)
    await redis.del(`otp:user:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await pool.end()
  redis.disconnect()
})

function signWebhook(bodyObj: unknown): { body: string; signature: string } {
  const body = JSON.stringify(bodyObj)
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET!).update(body).digest('hex')
  return { body, signature }
}

/**
 * settleRideCompletionPayment (rides.service.ts) runs fire-and-forget after
 * end-otp verification (`void settleRideCompletionPayment(...).catch(...)`),
 * so the payments row for an online ride appears asynchronously, not
 * synchronously with the end-otp HTTP response. Poll for it.
 */
async function waitForPendingOnlinePayment(rideId: string) {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query<{ id: string; status: string; razorpay_order_id: string | null }>(
      'SELECT id, status, razorpay_order_id FROM payments WHERE ride_id = $1', [rideId]
    )
    if (rows[0]?.razorpay_order_id) return rows[0]
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out waiting for pending online payment with razorpay_order_id for ride ${rideId}`)
}

/** Wallet channel's settleRideCompletionPayment (rides.service.ts) is also
 * fire-and-forget after end-otp — poll for the payment to reach 'completed'. */
async function waitForWalletPaymentCompleted(rideId: string) {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query<{ id: string; status: string; amount: string }>(
      `SELECT id, status, amount FROM payments WHERE ride_id = $1 AND channel = 'platform_wallet'`, [rideId]
    )
    if (rows[0]?.status === 'completed') return rows[0]
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out waiting for completed wallet payment for ride ${rideId}`)
}

/**
 * When the wallet balance is insufficient, settleRideCompletionPayment leaves
 * the payment 'pending' (same status it starts in) — there's no status
 * transition to poll for. notifyRidePaymentFailed's in-app feed row is the
 * one observable side effect that only happens once the insufficient-balance
 * branch has finished running, so it's the reliable "settlement is done"
 * signal for this case.
 */
async function waitForPaymentFailedNotification(rideId: string, userId: string) {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM notification_logs
       WHERE owner_type = 'user' AND owner_id = $1 AND type = 'payment_failed' AND ride_id = $2
       LIMIT 1`,
      [userId, rideId]
    )
    if (rows[0]) return rows[0]
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out waiting for payment_failed notification for ride ${rideId}`)
}

/**
 * The legacy auto-settle cash path (settleRideCompletionPayment,
 * rides.service.ts, taken when the `cash_collection_enabled` kill switch is
 * off) creates the 'cash_direct' payment fire-and-forget after end-otp, same
 * as the wallet/online channels — poll for it.
 */
async function waitForCashPaymentCompleted(rideId: string) {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query<{ id: string; status: string; amount: string }>(
      `SELECT id, status, amount FROM payments WHERE ride_id = $1 AND channel = 'cash_direct'`, [rideId]
    )
    if (rows[0]?.status === 'completed') return rows[0]
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out waiting for completed cash payment for ride ${rideId}`)
}

/**
 * getConfigValue (lib/system-config.ts) is cache-aside via Redis
 * (`ref:v1:config:<key>`, 30s TTL) — a raw SQL UPDATE alone would leave a
 * stale cached value in place for up to 30s. Delete the cache key ourselves
 * (same effect as the admin-update invalidation path) so the flip takes
 * effect immediately.
 */
async function setConfigValue(key: string, value: string) {
  await pool.query(
    `UPDATE system_config SET value = $2 WHERE key = $1`,
    [key, value]
  )
  await redis.del(`ref:v1:config:${key}`)
}

/**
 * findNearbyDrivers (broadcast.processor.ts) caps a broadcast round at
 * BROADCAST_MAX_DRIVERS (5, constants/limits.ts). Every driver this file logs
 * online stays 'online' after its ride completes (driveRideToCompletion never
 * takes it offline), and they all share the same lat/lng — so once 5 tests'
 * worth of drivers have accumulated, a 6th test's brand-new driver can lose
 * its own broadcast slot to older drivers and never receive an offer at all
 * (accept then 409s with "Ride no longer available" — no ride_assignments row
 * exists for it). Explicitly going offline after each test's ride keeps this
 * file's online-driver count bounded regardless of execution order.
 */
async function takeDriverOffline(app: ReturnType<typeof createApp>, accessToken: string) {
  await request(app)
    .post('/api/v1/rides/sessions/offline')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({})
}

describe('M08 — Payments', () => {
  describe('Webhook processing', () => {
    it('TC-M08-003 + TC-M08-004: webhook payment.captured marks payment completed, duplicate webhook is idempotent', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.onlineDriver)
      const { accessToken: userToken } = await loginUser(app, redis, PHONES.payer)

      const bookRes = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING, paymentChannel: 'online' })
      expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
      const rideId = bookRes.body.rideId as string

      // Drive the ride to completion — createRidePaymentOrder (and thus a pending
      // payment with a real razorpay_order_id) is only created by
      // settleRideCompletionPayment on ride completion, not at booking time.
      await driveRideToCompletion(app, rideId, driver, userToken)

      const payment = await waitForPendingOnlinePayment(rideId)
      expect(payment.status).toBe('pending')
      const orderId = payment.razorpay_order_id!

      const eventPayload = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: `pay_test_${rideId}`, order_id: orderId, status: 'captured' } } },
      }
      const { body, signature } = signWebhook(eventPayload)

      const firstRes = await request(app)
        .post('/api/v1/payments/webhook/razorpay')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(body)
      expect(firstRes.status, JSON.stringify(firstRes.body)).toBe(200)

      const { rows: afterFirst } = await pool.query<{ status: string }>(
        'SELECT status FROM payments WHERE id = $1', [payment.id]
      )
      expect(afterFirst[0]?.status).toBe('completed')

      // Same event, sent again — must be a no-op, not a double-credit. The dedup
      // guard (handleWebhookEvent in payments.service.ts) keys off razorpay_event_id,
      // which is populated from payload.payment.entity.id (the Razorpay payment id,
      // NOT a separate "event id" field — Razorpay webhook payloads for payment
      // events don't carry one, so the code reuses the payment entity id as the
      // dedup key). A second delivery of the same payload is therefore rejected by
      // `SELECT id FROM payment_gateway_events WHERE razorpay_event_id = $1` before
      // confirmRidePayment ever runs again.
      const secondRes = await request(app)
        .post('/api/v1/payments/webhook/razorpay')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(body)
      expect(secondRes.status, JSON.stringify(secondRes.body)).toBe(200)

      const { rows: dedupRows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM payment_gateway_events WHERE razorpay_event_id = $1`,
        [`pay_test_${rideId}`]
      )
      expect(dedupRows[0]?.n).toBe(1)

      const { rows: afterSecond } = await pool.query<{ status: string; commission_amount: string }>(
        'SELECT status, commission_amount FROM payments WHERE id = $1', [payment.id]
      )
      expect(afterSecond[0]?.status).toBe('completed')

      // No double-credit: exactly one commission-debit ledger row for this ride.
      const { rows: ledgerRows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM driver_wallet_ledger
         WHERE ride_id = $1 AND entry_type = 'commission_debit'`,
        [rideId]
      )
      expect(ledgerRows[0]?.n).toBe(1)
    })

    it('rejects a webhook with a bad signature', async () => {
      const eventPayload = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_bad', order_id: 'order_bad' } } } }
      const res = await request(app)
        .post('/api/v1/payments/webhook/razorpay')
        .set('x-razorpay-signature', 'deadbeef')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(eventPayload))
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('WEBHOOK_INVALID_SIGNATURE')
    })
  })

  describe('Wallet payment', () => {
    it('TC-M08-005: wallet debit succeeds when balance sufficient', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.walletDriverSufficient)
      const { accessToken, userId } = await loginUser(app, redis, PHONES.walletSufficient)
      await pool.query(
        `INSERT INTO user_wallets (user_id, balance) VALUES ($1, 5000)
         ON CONFLICT (user_id) DO UPDATE SET balance = 5000`,
        [userId]
      )

      const bookRes = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING, paymentChannel: 'wallet' })
      expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
      const rideId = bookRes.body.rideId as string

      // Wallet debit only happens at ride completion (settleRideCompletionPayment,
      // rides.service.ts), not at booking time — same as the online-payment flow above.
      await driveRideToCompletion(app, rideId, driver, accessToken)

      const payment = await waitForWalletPaymentCompleted(rideId)
      expect(payment.status).toBe('completed')

      // Use the amount actually captured on the payment row (set by
      // createPaymentRecord from the fare snapshot at settlement time) rather
      // than re-deriving from fare_snapshots — it's the authoritative figure
      // payFromUserWallet was invoked with.
      const fareAmount = parseFloat(payment.amount)
      expect(fareAmount).toBeGreaterThan(0)

      // confirmRidePayment (payments.service.ts) also credits a cashback ledger
      // entry on every successful ride payment regardless of channel, so the
      // wallet's *final* balance isn't simply `5000 - fareAmount` — it's that
      // minus the debit, plus a subsequent cashback credit. Assert the debit
      // itself via the ride_debit ledger row's own balance_after (the balance
      // immediately after the debit, before cashback lands), which isolates
      // exactly what payFromUserWallet did.
      const { rows: debitRows } = await pool.query<{ amount: string; balance_after: string }>(
        `SELECT amount, balance_after FROM user_wallet_ledger
         WHERE ride_id = $1 AND entry_type = 'ride_debit'`,
        [rideId]
      )
      expect(debitRows).toHaveLength(1)
      expect(parseFloat(debitRows[0]!.amount)).toBeCloseTo(fareAmount, 2)
      expect(parseFloat(debitRows[0]!.balance_after)).toBeCloseTo(5000 - fareAmount, 2)
    })

    it('TC-M08-006: wallet debit is skipped and payment stays pending when balance insufficient', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.walletDriverInsufficient)
      const { accessToken, userId } = await loginUser(app, redis, PHONES.walletInsufficient)
      await pool.query(
        `INSERT INTO user_wallets (user_id, balance) VALUES ($1, 1)
         ON CONFLICT (user_id) DO UPDATE SET balance = 1`,
        [userId]
      )

      const bookRes = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING, paymentChannel: 'wallet' })
      expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
      const rideId = bookRes.body.rideId as string

      // payFromUserWallet (payments.service.ts) rejects the debit entirely when
      // balance < fare — no partial debit, payment stays 'pending', and the rider
      // is proactively notified (notifyRidePaymentFailed) so they can retry.
      // end-otp itself still returns 200: settlement runs fire-and-forget after
      // the ride is already marked completed.
      await driveRideToCompletion(app, rideId, driver, accessToken)

      await waitForPaymentFailedNotification(rideId, userId)

      const { rows: paymentRows } = await pool.query<{ status: string }>(
        `SELECT status FROM payments WHERE ride_id = $1 AND channel = 'platform_wallet'`, [rideId]
      )
      expect(paymentRows[0]?.status).toBe('pending')

      const { rows: walletRows } = await pool.query<{ balance: string }>(
        `SELECT balance FROM user_wallets WHERE user_id = $1`, [userId]
      )
      expect(parseFloat(walletRows[0]!.balance)).toBe(1)

      const { rows: ledgerRows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM user_wallet_ledger WHERE ride_id = $1 AND entry_type = 'ride_debit'`,
        [rideId]
      )
      expect(ledgerRows[0]?.n).toBe(0)
    })
  })

  describe('Cash payment', () => {
    it('TC-M08-001: driver cash collection settles the ride and matches the fare', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.cashDriver)
      const { accessToken: userToken } = await loginUser(app, redis, PHONES.cashPayer)

      const bookRes = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING, paymentChannel: 'cash' })
      expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
      const rideId = bookRes.body.rideId as string

      await driveRideToCompletion(app, rideId, driver, userToken)

      // With cash_collection_enabled=true (the seeded default, migration 064),
      // settleRideCompletionPayment only signals the driver app to show the
      // cash-collection screen — it does NOT create a payments row. Settlement
      // is entirely driven by the explicit POST /:id/collect-cash below.
      const { rows: beforeCollect } = await pool.query(
        `SELECT id FROM payments WHERE ride_id = $1`, [rideId]
      )
      expect(beforeCollect).toHaveLength(0)

      const { rows: fareRows } = await pool.query<{ amount: string }>(
        `SELECT COALESCE(total_final, total_estimated) AS amount FROM fare_snapshots WHERE ride_id = $1`,
        [rideId]
      )
      const fare = parseFloat(fareRows[0]!.amount)

      const collectRes = await request(app)
        .post(`/api/v1/rides/${rideId}/collect-cash`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ collectedAmount: fare })
      expect(collectRes.status, JSON.stringify(collectRes.body)).toBe(200)
      expect(collectRes.body.discrepancy).toBe(false)
      expect(collectRes.body.collected).toBeCloseTo(fare, 2)

      const { rows: paymentRows } = await pool.query<{
        status: string; channel: string; commission_amount: string; driver_earning: string; amount: string
      }>(
        `SELECT status, channel, commission_amount, driver_earning, amount FROM payments WHERE ride_id = $1`,
        [rideId]
      )
      expect(paymentRows).toHaveLength(1)
      expect(paymentRows[0]!.status).toBe('completed')
      expect(paymentRows[0]!.channel).toBe('cash_direct')
      expect(parseFloat(paymentRows[0]!.amount)).toBeCloseTo(fare, 2)
      // Seeded default commission_percent is 15 — see migration 016_seed.sql.
      expect(parseFloat(paymentRows[0]!.commission_amount)).toBeCloseTo(Math.round(fare * 15) / 100, 2)

      const { rows: rideRows } = await pool.query<{
        cash_collected_amount: string; cash_collected_at: Date | null; cash_discrepancy: boolean
      }>(
        `SELECT cash_collected_amount, cash_collected_at, cash_discrepancy FROM rides WHERE id = $1`,
        [rideId]
      )
      expect(rideRows[0]!.cash_collected_at).not.toBeNull()
      expect(parseFloat(rideRows[0]!.cash_collected_amount)).toBeCloseTo(fare, 2)
      expect(rideRows[0]!.cash_discrepancy).toBe(false)

      // Commission is deducted from the driver's wallet (owed to the platform),
      // exactly like every other channel's settlement.
      const { rows: driverLedgerRows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM driver_wallet_ledger WHERE ride_id = $1 AND entry_type = 'commission_debit'`,
        [rideId]
      )
      expect(driverLedgerRows[0]?.n).toBe(1)

      // A second collect-cash call must be idempotent — the claim guard
      // (cash_collected_at IS NULL) means the loser just echoes back the same
      // collected/discrepancy values, never re-runs settlement.
      const secondCollectRes = await request(app)
        .post(`/api/v1/rides/${rideId}/collect-cash`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ collectedAmount: fare })
      expect(secondCollectRes.status, JSON.stringify(secondCollectRes.body)).toBe(200)
      expect(secondCollectRes.body.collected).toBeCloseTo(fare, 2)
      expect(secondCollectRes.body.discrepancy).toBe(false)

      const { rows: driverLedgerRowsAfter } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM driver_wallet_ledger WHERE ride_id = $1 AND entry_type = 'commission_debit'`,
        [rideId]
      )
      expect(driverLedgerRowsAfter[0]?.n).toBe(1)

      await takeDriverOffline(app, driver.accessToken)
    })
  })

  describe('Online payment order creation', () => {
    it('TC-M08-002: retrying a pending online payment issues a fresh Razorpay order', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.retryDriver)
      const { accessToken: userToken, userId } = await loginUser(app, redis, PHONES.retryPayer)

      const bookRes = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING, paymentChannel: 'online' })
      expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
      const rideId = bookRes.body.rideId as string

      await driveRideToCompletion(app, rideId, driver, userToken)

      const initialPayment = await waitForPendingOnlinePayment(rideId)
      expect(initialPayment.status).toBe('pending')

      // retryRidePayment (payments.service.ts) re-runs createRidePaymentOrder for
      // an 'online' channel payment stuck pending — same shape returned to the
      // client as the initial settlement would have pushed over the socket:
      // { orderId, key, amount }.
      const retryRes = await request(app)
        .post(`/api/v1/rides/${rideId}/payment/retry`)
        .set('Authorization', `Bearer ${userToken}`)
      expect(retryRes.status, JSON.stringify(retryRes.body)).toBe(200)
      expect(retryRes.body.channel).toBe('online')
      expect(retryRes.body.order).not.toBeNull()
      expect(typeof retryRes.body.order.orderId).toBe('string')
      expect(retryRes.body.order.orderId).toMatch(/^order_test_/)
      expect(retryRes.body.order.key).toBe(process.env['RAZORPAY_KEY_ID'])
      expect(typeof retryRes.body.order.amount).toBe('number')
      expect(retryRes.body.order.amount).toBeGreaterThan(0)

      // Order creation alone never confirms the payment — status stays
      // 'pending' until /payment/verify or the webhook lands.
      const { rows: paymentRows } = await pool.query<{ status: string; razorpay_order_id: string }>(
        `SELECT status, razorpay_order_id FROM payments WHERE ride_id = $1`, [rideId]
      )
      expect(paymentRows[0]!.status).toBe('pending')
      expect(paymentRows[0]!.razorpay_order_id).toBe(retryRes.body.order.orderId)

      // The fresh order is bound to the requesting user in Redis (ridePaymentOrderKey),
      // same as the original settlement-time order — this is what /payment/verify
      // checks to reject a replayed order/signature from a different user.
      const boundUserId = await redis.get(`ride:payment_order:${retryRes.body.order.orderId}`)
      expect(boundUserId).toBe(userId)

      await takeDriverOffline(app, driver.accessToken)
    })
  })

  describe('Legacy cash auto-settle (kill switch off)', () => {
    it('TC-M08-007: settleRideCompletionPayment auto-settles cash rides when cash_collection_enabled=false', async () => {
      await setConfigValue('cash_collection_enabled', 'false')
      try {
        const driver = await setupOnlineDriver(app, pool, redis, PHONES.autoSettleDriver)
        const { accessToken: userToken } = await loginUser(app, redis, PHONES.autoSettlePayer)

        const bookRes = await request(app)
          .post('/api/v1/rides')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING, paymentChannel: 'cash' })
        expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
        const rideId = bookRes.body.rideId as string

        // No collect-cash call here at all — with the kill switch off,
        // settleRideCompletionPayment settles automatically on end-otp,
        // fire-and-forget, exactly like the wallet/online channels do.
        await driveRideToCompletion(app, rideId, driver, userToken)

        const payment = await waitForCashPaymentCompleted(rideId)
        expect(payment.status).toBe('completed')

        const fare = parseFloat(payment.amount)
        expect(fare).toBeGreaterThan(0)

        const { rows: rideRows } = await pool.query<{
          cash_collected_amount: string; cash_collected_at: Date | null; cash_discrepancy: boolean
        }>(
          `SELECT cash_collected_amount, cash_collected_at, cash_discrepancy FROM rides WHERE id = $1`,
          [rideId]
        )
        // The auto-settle branch stamps the same cash_collected_* columns
        // collectCash uses, at the full fare amount, with no discrepancy.
        expect(rideRows[0]!.cash_collected_at).not.toBeNull()
        expect(parseFloat(rideRows[0]!.cash_collected_amount)).toBeCloseTo(fare, 2)
        expect(rideRows[0]!.cash_discrepancy).toBe(false)

        const { rows: driverLedgerRows } = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM driver_wallet_ledger WHERE ride_id = $1 AND entry_type = 'commission_debit'`,
          [rideId]
        )
        expect(driverLedgerRows[0]?.n).toBe(1)

        await takeDriverOffline(app, driver.accessToken)
      } finally {
        // Restore the shared kill switch — other tests in this file (and the
        // default booking flow) assume cash_collection_enabled=true.
        await setConfigValue('cash_collection_enabled', 'true')
      }
    })
  })

  describe('Cashback', () => {
    it('TC-M08-008: completing a ride credits the rider a cashback ledger entry', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.cashbackDriver)
      const { accessToken: userToken, userId } = await loginUser(app, redis, PHONES.cashbackPayer)

      const bookRes = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING, paymentChannel: 'cash' })
      expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
      const rideId = bookRes.body.rideId as string

      await driveRideToCompletion(app, rideId, driver, userToken)

      const { rows: fareRows } = await pool.query<{ amount: string }>(
        `SELECT COALESCE(total_final, total_estimated) AS amount FROM fare_snapshots WHERE ride_id = $1`,
        [rideId]
      )
      const fare = parseFloat(fareRows[0]!.amount)

      // creditCashback (payments.service.ts) only runs once collectCash settles
      // the ride (cash_collection_enabled defaults to true).
      const collectRes = await request(app)
        .post(`/api/v1/rides/${rideId}/collect-cash`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ collectedAmount: fare })
      expect(collectRes.status, JSON.stringify(collectRes.body)).toBe(200)

      const { rows: ledgerRows } = await pool.query<{
        entry_type: string; direction: string; amount: string; balance_after: string; expires_at: Date
      }>(
        `SELECT entry_type, direction, amount, balance_after, expires_at
         FROM user_wallet_ledger WHERE ride_id = $1 AND entry_type = 'cashback'`,
        [rideId]
      )
      expect(ledgerRows).toHaveLength(1)
      expect(ledgerRows[0]!.direction).toBe('credit')
      // Seeded default cashback_ride_percent is 5 — see migration 016_seed.sql.
      const expectedCashback = Math.round(fare * 5) / 100
      expect(parseFloat(ledgerRows[0]!.amount)).toBeCloseTo(expectedCashback, 2)
      expect(parseFloat(ledgerRows[0]!.balance_after)).toBeCloseTo(expectedCashback, 2)

      // Seeded default cashback_expiry_days is 30 — see migration 016_seed.sql.
      // Assert a wide window (25-35 days out) to avoid flaking on clock skew
      // between the app and the test process, not the exact 30-day boundary.
      const now = Date.now()
      const expiresInDays = (new Date(ledgerRows[0]!.expires_at).getTime() - now) / (1000 * 60 * 60 * 24)
      expect(expiresInDays).toBeGreaterThan(25)
      expect(expiresInDays).toBeLessThan(35)

      const { rows: walletRows } = await pool.query<{ balance: string; lifetime_earned: string }>(
        `SELECT balance, lifetime_earned FROM user_wallets WHERE user_id = $1`,
        [userId]
      )
      expect(parseFloat(walletRows[0]!.balance)).toBeCloseTo(expectedCashback, 2)
      expect(parseFloat(walletRows[0]!.lifetime_earned)).toBeCloseTo(expectedCashback, 2)

      await takeDriverOffline(app, driver.accessToken)
    })
  })
})
