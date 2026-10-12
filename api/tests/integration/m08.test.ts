import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { config } from '@/config'
import { fetchPayuStatus, toPaise } from '@/lib/payu'
import {
  loginUser, setupOnlineDriver, cleanupRideAndDriverData, DEFAULT_BOOKING, driveRideToCompletion,
  waitForWalletPaymentCompleted,
} from '../helpers/fixtures/rides.fixture'

// Online ride payments go through PayU (payments.service.ts::createRidePaymentOrder):
// with PAYU_KEY / PAYU_SALT configured (see .env / ci.yml) it writes a pending
// payment with a gateway_txn_id and returns a signed hosted-checkout form; with
// them unset it auto-confirms in dev mode and never reaches the return/webhook
// path. Confirmation calls PayU's verify_payment (fetchPayuStatus) — mocked here
// at the module boundary so the network is never touched; everything else in
// lib/payu (hashing, form building) is the real code.
vi.mock('@/lib/payu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payu')>()),
  fetchPayuStatus: vi.fn(),
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
  payuReturnPayer: '+919700000071',
  payuReturnDriver: '+919700000072',
  payuWebhookPayer: '+919700000073',
  payuWebhookDriver: '+919700000074',
  retryCapturedPayer: '+919700000075',
  retryCapturedDriver: '+919700000076',
  retryPendingPayer: '+919700000077',
  retryPendingDriver: '+919700000078',
} as const

let categoryId: number

beforeAll(async () => {
  if (!WEBHOOK_SECRET) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET must be set in the test environment for M08 webhook tests')
  }
  if (!config.PAYU_KEY || !config.PAYU_SALT) {
    // Empty keys = dev auto-confirm: the online payment would complete without
    // ever reaching the PayU return/webhook path these tests exercise.
    throw new Error('PAYU_KEY and PAYU_SALT must be set in the test environment for M08 PayU tests')
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
 * PayU reverse (response) hash, built exactly like verifyPayuResponseHash in
 * lib/payu.ts: SALT|status|udf10..udf6|udf5..udf1|email|firstname|productinfo|
 * amount|txnid|KEY (all ten udf slots empty), from the same config the server
 * reads. Signs whatever fields are posted, so the posted values and the hash
 * always agree.
 */
function signPayu(fields: Record<string, string>): Record<string, string> {
  const g = (k: string): string => fields[k] ?? ''
  const parts = [
    config.PAYU_SALT, g('status'),
    '', '', '', '', '', // udf10..udf6
    '', '', '', '', '', // udf5..udf1
    g('email'), g('firstname'), g('productinfo'), g('amount'), g('txnid'), config.PAYU_KEY,
  ]
  const hash = crypto.createHash('sha512').update(parts.join('|')).digest('hex')
  return { ...fields, hash }
}

/** A PayU success callback body (return POST or webhook) for one txn. */
function payuSuccessBody(txnid: string, amount: string, mihpayid: string): Record<string, string> {
  return signPayu({
    txnid, mihpayid, amount,
    status: 'success',
    productinfo: 'Ocar ride',
    firstname: 'Customer',
    email: 'rider@example.test',
  })
}

/**
 * Make the mocked verify_payment report this txn as captured for exactly the
 * stored amount — the only source the funnel confirms money from.
 */
function mockPayuCaptured(amount: string, mihpayid: string) {
  vi.mocked(fetchPayuStatus).mockResolvedValue({ state: 'captured', amountPaise: toPaise(amount), mihpayid })
}

/**
 * settleRideCompletionPayment (rides.service.ts) runs fire-and-forget after
 * end-otp verification (`void settleRideCompletionPayment(...).catch(...)`),
 * so the payments row for an online ride appears asynchronously, not
 * synchronously with the end-otp HTTP response. Poll until createRidePaymentOrder
 * has stamped the PayU gateway_txn_id on it.
 */
async function waitForPendingOnlinePayment(rideId: string) {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query<{ id: string; status: string; amount: string; gateway_txn_id: string | null }>(
      'SELECT id, status, amount, gateway_txn_id FROM payments WHERE ride_id = $1', [rideId]
    )
    if (rows[0]?.gateway_txn_id) return rows[0]
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out waiting for pending online payment with gateway_txn_id for ride ${rideId}`)
}

/**
 * Settlement side effects a confirmed ride payment writes exactly once.
 * The 1/1/1 counts asserted below assume the default commission billing mode
 * (not package) and the seeded cashback config; change either and they move.
 */
async function countSettlementRows(rideId: string) {
  const { rows } = await pool.query<{ commission: number; earning: number; cashback: number }>(
    `SELECT
       (SELECT count(*)::int FROM driver_wallet_ledger WHERE ride_id = $1 AND entry_type = 'commission_debit') AS commission,
       (SELECT count(*)::int FROM driver_earnings WHERE ride_id = $1 AND entry_type = 'ride_fare_net') AS earning,
       (SELECT count(*)::int FROM user_wallet_ledger WHERE ride_id = $1 AND entry_type = 'cashback') AS cashback`,
    [rideId]
  )
  return rows[0]!
}

/** Book an online ride and drive it to completion; returns the pending PayU payment. */
async function completeOnlineRide(driverPhone: string, payerPhone: string) {
  const driver = await setupOnlineDriver(app, pool, redis, driverPhone)
  const { accessToken: userToken, userId } = await loginUser(app, redis, payerPhone)

  const bookRes = await request(app)
    .post('/api/v1/rides')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING, paymentChannel: 'online' })
  expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
  const rideId = bookRes.body.rideId as string

  // The pending payment (and its PayU txn) is only created by
  // settleRideCompletionPayment on ride completion, not at booking time.
  await driveRideToCompletion(app, rideId, driver, userToken)

  const payment = await waitForPendingOnlinePayment(rideId)
  expect(payment.status).toBe('pending')
  return { rideId, userId, userToken, payment, txnId: payment.gateway_txn_id! }
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
/**
 * The cash_direct payment row is inserted 'completed' first, but
 * settleRideCompletionPayment's commission-debit and `rides.cash_collected_at`
 * UPDATE both run *after* that insert — polling only the payment row races
 * against those later steps. Wait for the rides row to be stamped too, since
 * that's the last write in the sequence and what callers assert on next.
 */
async function waitForCashPaymentCompleted(rideId: string) {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query<{ id: string; status: string; amount: string; cash_collected_at: Date | null }>(
      `SELECT p.id, p.status, p.amount, r.cash_collected_at
       FROM payments p JOIN rides r ON r.id = p.ride_id
       WHERE p.ride_id = $1 AND p.channel = 'cash_direct'`, [rideId]
    )
    if (rows[0]?.status === 'completed' && rows[0]?.cash_collected_at) return rows[0]
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

async function getConfigValue(key: string): Promise<string> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM system_config WHERE key = $1`, [key]
  )
  if (!rows[0]) throw new Error(`system_config key not found: ${key}`)
  return rows[0].value
}

describe('M08 — Payments', () => {
  describe('Webhook processing', () => {
    it('TC-M08-003 + TC-M08-004: legacy Razorpay webhook payment.captured marks payment completed, duplicate webhook is idempotent', async () => {
      // New online payments go through PayU, so the API no longer creates a
      // Razorpay order. /webhook/razorpay stays live for payments created before
      // the cutover (and for payouts), so seed such an in-flight row directly:
      // complete an online ride, then turn its pending payment back into the
      // pre-PayU shape (razorpay_online, razorpay_order_id, no PayU txn).
      const { rideId, payment } = await completeOnlineRide(PHONES.onlineDriver, PHONES.payer)
      const orderId = `order_test_${rideId}`
      await pool.query(
        `UPDATE payments
           SET channel = 'razorpay_online', gateway = NULL, gateway_txn_id = NULL, razorpay_order_id = $2
         WHERE id = $1`,
        [payment.id, orderId]
      )

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

      const payment = await waitForWalletPaymentCompleted(pool, rideId)
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
      // driver_earning = amount - commission_amount (the invariant createPaymentRecord enforces).
      expect(parseFloat(paymentRows[0]!.driver_earning)).toBeCloseTo(
        parseFloat(paymentRows[0]!.amount) - parseFloat(paymentRows[0]!.commission_amount), 2
      )

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
    })
  })

  describe('Online payment order creation', () => {
    it('TC-M08-002: retrying a pending online payment issues a fresh PayU txnid', async () => {
      const { rideId, userToken, txnId: initialTxnId } = await completeOnlineRide(PHONES.retryDriver, PHONES.retryPayer)

      // retryRidePayment (payments.service.ts) re-runs createRidePaymentOrder for
      // an online payment stuck pending — same { payu: { action, fields }, amount }
      // shape the settlement pushed over the socket. Before overwriting the old
      // txn, retryRidePayment asks PayU about it (fail-closed guard): here the
      // rider never opened PayU's page, so verify_payment has no record of it.
      vi.mocked(fetchPayuStatus).mockResolvedValueOnce({ state: 'unknown', amountPaise: 0, mihpayid: null })
      const retryRes = await request(app)
        .post(`/api/v1/rides/${rideId}/payment/retry`)
        .set('Authorization', `Bearer ${userToken}`)
      expect(retryRes.status, JSON.stringify(retryRes.body)).toBe(200)
      expect(retryRes.body.channel).toBe('online')
      expect(retryRes.body.order).not.toBeNull()
      const fields = retryRes.body.order.payu.fields as Record<string, string>
      expect(typeof retryRes.body.order.payu.action).toBe('string')
      expect(fields['key']).toBe(config.PAYU_KEY)
      expect(fields['txnid']).toMatch(new RegExp(`^R${rideId}x`))
      expect(fields['txnid']).not.toBe(initialTxnId)
      expect(fields['hash']).toMatch(/^[0-9a-f]{128}$/)
      expect(typeof retryRes.body.order.amount).toBe('number')
      expect(retryRes.body.order.amount).toBeGreaterThan(0)

      // Form creation alone never confirms the payment — status stays 'pending'
      // until the PayU return/webhook (or reconcile) lands. The fresh txnid
      // supersedes the old one on the row.
      const { rows: paymentRows } = await pool.query<{ status: string; gateway: string; gateway_txn_id: string }>(
        `SELECT status, gateway, gateway_txn_id FROM payments WHERE ride_id = $1`, [rideId]
      )
      expect(paymentRows[0]!.status).toBe('pending')
      expect(paymentRows[0]!.gateway).toBe('payu')
      expect(paymentRows[0]!.gateway_txn_id).toBe(fields['txnid'])
    })

    it.each([
      ['captured', 'Payment is already being confirmed'],
      ['pending', 'Your previous payment is still being processed'],
    ] as const)('retry is refused with 409 while the previous PayU txn is %s, leaving the row untouched', async (state, message) => {
      const { rideId, userToken, txnId } = await completeOnlineRide(
        state === 'captured' ? PHONES.retryCapturedDriver : PHONES.retryPendingDriver,
        state === 'captured' ? PHONES.retryCapturedPayer : PHONES.retryPendingPayer,
      )
      vi.mocked(fetchPayuStatus).mockResolvedValueOnce({ state, amountPaise: 0, mihpayid: null })
      const retryRes = await request(app)
        .post(`/api/v1/rides/${rideId}/payment/retry`)
        .set('Authorization', `Bearer ${userToken}`)
      expect(retryRes.status, JSON.stringify(retryRes.body)).toBe(409)
      expect(retryRes.body.error).toContain(message)

      const { rows } = await pool.query<{ status: string; gateway_txn_id: string }>(
        `SELECT status, gateway_txn_id FROM payments WHERE ride_id = $1`, [rideId]
      )
      expect(rows[0]!.status).toBe('pending')
      expect(rows[0]!.gateway_txn_id).toBe(txnId)
    })
  })

  describe('PayU return and webhook', () => {
    it('signed return POST confirms the payment once; replaying it is a no-op', async () => {
      const { rideId, payment, txnId } = await completeOnlineRide(PHONES.payuReturnDriver, PHONES.payuReturnPayer)
      const mihpayid = `mp${txnId}`
      mockPayuCaptured(payment.amount, mihpayid)
      const body = payuSuccessBody(txnId, payment.amount, mihpayid)
      const receiptUrl = `${config.USER_APP_URL}/ride/${rideId}/receipt?pay=success`

      const firstRes = await request(app).post('/api/v1/payments/payu/return').type('form').send(body)
      expect(firstRes.status).toBe(303)
      expect(firstRes.headers['location']).toBe(receiptUrl)

      const { rows: afterFirst } = await pool.query<{ status: string; gateway_payment_id: string | null }>(
        'SELECT status, gateway_payment_id FROM payments WHERE id = $1', [payment.id]
      )
      expect(afterFirst[0]?.status).toBe('completed')
      expect(afterFirst[0]?.gateway_payment_id).toBe(mihpayid)
      expect(await countSettlementRows(rideId)).toEqual({ commission: 1, earning: 1, cashback: 1 })

      // Browser back/refresh re-posts the same form: confirmRidePayment's
      // WHERE status='pending' guard matches nothing and the row was settled by
      // this very capture, so it is a replay — still success, nothing re-credited.
      const replayRes = await request(app).post('/api/v1/payments/payu/return').type('form').send(body)
      expect(replayRes.status).toBe(303)
      expect(replayRes.headers['location']).toBe(receiptUrl)

      const { rows: afterReplay } = await pool.query<{ status: string }>(
        'SELECT status FROM payments WHERE id = $1', [payment.id]
      )
      expect(afterReplay[0]?.status).toBe('completed')
      expect(await countSettlementRows(rideId)).toEqual({ commission: 1, earning: 1, cashback: 1 })
    })

    it('rejects a bad hash on both entry points without touching the payment; a signed webhook confirms idempotently', async () => {
      const { rideId, payment, txnId } = await completeOnlineRide(PHONES.payuWebhookDriver, PHONES.payuWebhookPayer)
      const mihpayid = `mp${txnId}`
      mockPayuCaptured(payment.amount, mihpayid)
      const body = payuSuccessBody(txnId, payment.amount, mihpayid)

      // Bad hash on the return route: never a ride page, just the portal home.
      const badReturn = await request(app).post('/api/v1/payments/payu/return').type('form')
        .send({ ...body, hash: 'ab'.repeat(64) })
      expect(badReturn.status).toBe(303)
      expect(badReturn.headers['location']).toBe(`${config.USER_APP_URL}/`)

      // Tampered amount under the original hash is a bad hash too.
      const badWebhook = await request(app).post('/api/v1/payments/webhook/payu').type('form')
        .send({ ...body, amount: '1.00' })
      expect(badWebhook.status).toBe(400)
      expect(badWebhook.body.code).toBe('WEBHOOK_INVALID_SIGNATURE')

      const { rows: afterBad } = await pool.query<{ status: string }>(
        'SELECT status FROM payments WHERE id = $1', [payment.id]
      )
      expect(afterBad[0]?.status).toBe('pending')
      expect(await countSettlementRows(rideId)).toEqual({ commission: 0, earning: 0, cashback: 0 })

      // Signed webhook delivered twice (PayU may retry): confirms once.
      for (let i = 0; i < 2; i++) {
        const res = await request(app).post('/api/v1/payments/webhook/payu').type('form').send(body)
        expect(res.status, JSON.stringify(res.body)).toBe(200)
      }

      const { rows: afterWebhook } = await pool.query<{ status: string; gateway_payment_id: string | null }>(
        'SELECT status, gateway_payment_id FROM payments WHERE id = $1', [payment.id]
      )
      expect(afterWebhook[0]?.status).toBe('completed')
      expect(afterWebhook[0]?.gateway_payment_id).toBe(mihpayid)
      expect(await countSettlementRows(rideId)).toEqual({ commission: 1, earning: 1, cashback: 1 })

      // Audit row deduped on `${mihpayid}:${state}` (recordPayuEvent).
      const { rows: events } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM payment_gateway_events WHERE gateway_event_id = $1`,
        [`${mihpayid}:captured`]
      )
      expect(events[0]?.n).toBe(1)
    })
  })

  describe('Legacy cash auto-settle (kill switch off)', () => {
    it('TC-M08-007: settleRideCompletionPayment auto-settles cash rides when cash_collection_enabled=false', async () => {
      const originalValue = await getConfigValue('cash_collection_enabled')
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
      } finally {
        // Restore the shared kill switch to whatever it was before this test
        // flipped it (not a hardcoded 'true') — and verify the restore actually
        // landed, so a failed restore fails this test loudly instead of silently
        // leaving the flag wrong for whatever runs next against this DB.
        await setConfigValue('cash_collection_enabled', originalValue)
        const restoredValue = await getConfigValue('cash_collection_enabled')
        expect(restoredValue).toBe(originalValue)
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
    })
  })
})
