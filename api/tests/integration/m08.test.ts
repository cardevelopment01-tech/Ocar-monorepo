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
})
