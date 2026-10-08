import type { PoolClient } from 'pg'
import { pool } from '@/db/client'
import { config } from '@/config'
import { client as redis } from '@/db/redis'
import { ridePaymentOrderKey, walletTopupOrderKey } from '@/constants/redis-keys'
import { notifyDriverLowWalletBalance } from '@/modules/notifications/notifications.service'
import { accrueDriverEarning, mapPayoutFailureCode } from '@/modules/payments/submodules/settlements/settlements.service'
import { getConfigValue } from '@/lib/system-config'
import { verifyHmacSignature } from '@/lib/hash'
import { logger } from '@/lib/logger'
import {
  payuConfigured, newTxnId, buildPayuForm, customerFor, PAYU_RETURN_PATH, TOPUP_PRODUCT_INFO, type PayuForm,
  verifyPayuResponseHash, fetchPayuStatus, toPaise, type PayuStatus,
} from '@/lib/payu'
import * as packagesService from '@/modules/packages/packages.service'
import * as packagesRepo from '@/modules/packages/packages.repository'
import type { BillingMode } from '@/modules/rides/rides.types'

const log = logger.child({ module: 'payments-service' })

// ── Config helpers ─────────────────────────────────────────────

async function getCommissionPercent(): Promise<number> {
  return parseFloat(await getConfigValue('commission_percent', '15'))
}

export async function getMinWalletBalance(): Promise<number> {
  return parseFloat(await getConfigValue('driver_minimum_balance', '500'))
}

async function getCashbackPercent(): Promise<number> {
  return parseFloat(await getConfigValue('cashback_ride_percent', '5'))
}

async function getCashbackExpiryDays(): Promise<number> {
  return parseInt(await getConfigValue('cashback_expiry_days', '30'))
}

// ── Driver wallet top-up (PayU) ────────────────────────────────

export const TOPUP_BINDING_TTL_SEC = 86_400
export const MAX_TOPUP_RUPEES = 50_000
export interface TopupBinding { driverId: string; amountPaise: number }

export async function createDriverTopupOrder(
  driverId: bigint,
  amount: number
): Promise<{ payu: PayuForm; amount: number }> {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 100) {
    throw Object.assign(new Error('Minimum top-up is ₹100'), { httpStatus: 400 })
  }
  if (amount > MAX_TOPUP_RUPEES) {
    throw Object.assign(new Error(`Maximum top-up is ₹${MAX_TOPUP_RUPEES.toLocaleString('en-IN')}`), { httpStatus: 400 })
  }
  const amountPaise = Math.round(amount * 100)
  const rupees = amountPaise / 100

  const driverRes = await pool.query(`SELECT full_name AS name, email, phone FROM drivers WHERE id = $1`, [driverId])
  const txnId = newTxnId('W', driverId)
  const payu = buildPayuForm({
    txnId, amount: rupees,
    productInfo: TOPUP_PRODUCT_INFO,
    customer: customerFor(driverRes.rows[0] ?? {}, 'driver', driverId),
    returnUrl: `${config.API_BASE_URL}${PAYU_RETURN_PATH}`,
  })
  // Durable row first: a form without it is a top-up nothing can ever sweep.
  // A failed insert throws, so no form is returned.
  await pool.query(
    `INSERT INTO wallet_topup_orders (driver_id, gateway_txn_id, amount) VALUES ($1, $2, $3)`,
    [driverId, txnId, rupees]
  )
  const binding: TopupBinding = { driverId: driverId.toString(), amountPaise }
  await redis.set(walletTopupOrderKey(txnId), JSON.stringify(binding), 'EX', TOPUP_BINDING_TTL_SEC)
  return { payu, amount: rupees }
}

// ── Payment record creation ────────────────────────────────────

export async function createPaymentRecord(
  rideId: bigint,
  channel: string = 'cash_direct',
  opts: { status?: 'pending' | 'completed' } = {}
): Promise<void> {
  const fareRes = await pool.query(
    `SELECT fs.id AS fare_snapshot_id,
            fs.total_final, fs.total_estimated,
            r.user_id, r.driver_id
     FROM fare_snapshots fs
     JOIN rides r ON r.id = fs.ride_id
     WHERE fs.ride_id = $1`,
    [rideId]
  )

  const fare = fareRes.rows[0]
  if (!fare) throw Object.assign(new Error('Fare snapshot not found'), { httpStatus: 404 })

  const amount = parseFloat(fare.total_final ?? fare.total_estimated)
  const commissionPct = await getCommissionPercent()
  const commissionAmt = Math.round(amount * commissionPct) / 100
  const driverEarning = Math.round((amount - commissionAmt) * 100) / 100

  const status = opts.status ?? 'completed'
  // Only a captured (completed) payment has a capture timestamp.
  const capturedAt = status === 'completed' ? new Date() : null

  await pool.query(
    `INSERT INTO payments (
       ride_id, user_id, driver_id, fare_snapshot_id,
       amount, channel, status,
       commission_percent, commission_amount, driver_earning,
       captured_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (ride_id) DO NOTHING`,
    [
      rideId, fare.user_id, fare.driver_id, fare.fare_snapshot_id,
      amount, channel, status, commissionPct, commissionAmt, driverEarning,
      capturedAt,
    ]
  )
}

// ── Commission deduction ───────────────────────────────────────

export async function deductCommission(
  rideId: bigint,
  driverId: bigint,
  sharedClient?: PoolClient
): Promise<{ newBalance: number } | null> {
  const payRes = await pool.query(
    `SELECT commission_amount FROM payments WHERE ride_id = $1`,
    [rideId]
  )
  const payment = payRes.rows[0]
  if (!payment) return null

  const commission = parseFloat(payment.commission_amount)
  const minBalance = await getMinWalletBalance()

  const client = sharedClient ?? await pool.connect()
  const owns = !sharedClient
  try {
    if (owns) await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_wallets (driver_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (driver_id) DO NOTHING`,
      [driverId]
    )

    const walletRes = await client.query(
      `SELECT id, balance, is_frozen
       FROM driver_wallets
       WHERE driver_id = $1
       FOR UPDATE`,
      [driverId]
    )

    const wallet = walletRes.rows[0]
    if (!wallet || wallet.is_frozen) {
      if (owns) await client.query('ROLLBACK')
      return null
    }

    const currentBalance = parseFloat(wallet.balance)
    // Signed balance: negative = driver owes the platform (cash dues). The goOnline
    // min-balance gate blocks re-activation until this is cleared (netted by digital
    // earnings or topped up). See migration 064.
    const newBalance = Math.round((currentBalance - commission) * 100) / 100

    await client.query(
      `UPDATE driver_wallets
       SET balance = $2,
           lifetime_commission = lifetime_commission + $3
       WHERE id = $1`,
      [wallet.id, newBalance, commission]
    )

    await client.query(
      `INSERT INTO driver_wallet_ledger (
         wallet_id, driver_id, entry_type,
         amount, direction, balance_after,
         ride_id, note
       ) VALUES ($1,$2,'commission_debit',$3,'debit',$4,$5,$6)`,
      [
        wallet.id, driverId, commission,
        newBalance, rideId,
        `Commission ₹${commission} for ride #${rideId}`,
      ]
    )

    // Ride-matching/go-online enforcement always re-reads live wallet balance
    // (see rides.repository.ts / goOnline) — this is a notify-only signal,
    // it never touches drivers.status. drivers.status is driver-lifecycle
    // state owned by admin/vehicle/onboarding flows; conflating a wallet dip
    // with it let a wallet top-up silently undo an unrelated admin suspension.
    const justCrossedBelowMin = currentBalance >= minBalance && newBalance < minBalance

    if (owns) {
      await client.query('COMMIT')
      if (justCrossedBelowMin) {
        try {
          await notifyDriverLowWalletBalance(driverId, newBalance, minBalance)
        } catch (err) {
          log.error({ err }, 'low-balance notify failed')
        }
      }
      return null
    }

    // Shared transaction: the notify must wait until the caller commits, so
    // hand the crossing info back instead of firing it inside an open txn.
    return justCrossedBelowMin ? { newBalance } : null
  } catch (err) {
    if (owns) await client.query('ROLLBACK')
    throw err
  } finally {
    if (owns) client.release()
  }
}

// ── User cashback ──────────────────────────────────────────────

export async function creditCashback(
  rideId: bigint,
  userId: bigint,
  fareAmount: number,
  sharedClient?: PoolClient
): Promise<void> {
  const cashbackPct = await getCashbackPercent()
  const cashbackAmt = Math.round(fareAmount * cashbackPct) / 100
  if (cashbackAmt <= 0) return

  const expiryDays = await getCashbackExpiryDays()

  const client = sharedClient ?? await pool.connect()
  const owns = !sharedClient
  try {
    if (owns) await client.query('BEGIN')

    await client.query(
      `INSERT INTO user_wallets (user_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    )

    const walletRes = await client.query(
      `SELECT id, balance FROM user_wallets WHERE user_id = $1 FOR UPDATE`,
      [userId]
    )

    const wallet = walletRes.rows[0]
    const newBalance = Math.round((parseFloat(wallet.balance) + cashbackAmt) * 100) / 100

    await client.query(
      `UPDATE user_wallets
       SET balance = $2,
           lifetime_earned = lifetime_earned + $3
       WHERE id = $1`,
      [wallet.id, newBalance, cashbackAmt]
    )

    await client.query(
      `INSERT INTO user_wallet_ledger (
         wallet_id, user_id, entry_type,
         amount, direction, balance_after,
         ride_id, expires_at, note
       ) VALUES ($1,$2,'cashback',$3,'credit',$4,$5,
         now() + ($6 || ' days')::interval, $7)`,
      [
        wallet.id, userId, cashbackAmt,
        newBalance, rideId, expiryDays,
        `${cashbackPct}% cashback on ride #${rideId}`,
      ]
    )

    if (owns) await client.query('COMMIT')
  } catch (err) {
    if (owns) await client.query('ROLLBACK')
    throw err
  } finally {
    if (owns) client.release()
  }
}

// ── Confirm a collected ride payment (shared by verify/webhook/reconcile) ──
// The `WHERE status='pending'` guard is the idempotency lock: only the first
// caller to flip pending→completed runs commission + cashback. Duplicate or
// stale triggers hit zero rows and return false (no-op). Razorpay does not
// guarantee webhook ordering, so this compare-before-write is mandatory.
// The flip and the commission-path settlement steps (deductCommission,
// accrueDriverEarning, creditCashback) now run on ONE transaction: a crash or
// thrown error between steps rolls the status flip back too, so a retried
// confirm re-enters this same guarded UPDATE as 'pending' instead of leaving
// the payment 'completed' with half-applied earnings/cashback and no
// reconciliation path.
export async function confirmRidePayment(
  rideId: bigint,
  paymentId?: string,
  gateway: 'razorpay' | 'payu' = 'razorpay'
): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const params: unknown[] = [rideId]
    let extraSet = ''
    if (paymentId !== undefined) {
      params.push(paymentId)
      // column names are hardcoded (never from input)
      extraSet = gateway === 'payu' ? ', gateway_payment_id = $2' : ', razorpay_payment_id = $2'
    }

    const res = await client.query(
      `UPDATE payments
         SET status = 'completed', captured_at = now()${extraSet}
       WHERE ride_id = $1 AND status = 'pending'
       RETURNING driver_id, user_id, amount`,
      params
    )

    if ((res.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK')
      return false
    }

    const row = res.rows[0]
    // billing_mode_snapshot is frozen on the ride at accept time (see acceptAssignment in
    // rides.repository.ts), so a later admin change to a city's billing_mode doesn't
    // retroactively change how an in-flight/already-accepted ride settles.
    const rideRes = await client.query<{ billing_mode_snapshot: BillingMode | null }>(
      `SELECT billing_mode_snapshot FROM rides WHERE id = $1`,
      [rideId]
    )
    const billingMode = rideRes.rows[0]?.billing_mode_snapshot ?? 'commission'

    let crossedBelowMin: { newBalance: number } | null = null
    if (billingMode === 'package') {
      // ponytail: consumePackageBalance lives in the packages module (out of this
      // plan's scope) and manages its own connection, so it can't join this txn.
      // It runs before COMMIT so a consume failure still rolls back the status
      // flip and the ride re-enters settlement on retry. Follow-up: thread a
      // shared client through consumePackageBalance to make package mode fully
      // atomic too — commission mode (the else branch) is already fully atomic.
      await packagesService.consumePackageBalance(rideId, BigInt(row.driver_id), parseFloat(row.amount))
    } else {
      crossedBelowMin = await deductCommission(rideId, BigInt(row.driver_id), client)
    }
    await accrueDriverEarning(rideId, BigInt(row.driver_id), client)
    await creditCashback(rideId, BigInt(row.user_id), parseFloat(row.amount), client)

    await client.query('COMMIT')

    if (crossedBelowMin) {
      try {
        const minBalance = await getMinWalletBalance()
        await notifyDriverLowWalletBalance(BigInt(row.driver_id), crossedBelowMin.newBalance, minBalance)
      } catch (err) {
        log.error({ err }, 'low-balance notify failed')
      }
    }
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Pay for a ride from the user wallet (atomic debit) ──────────
// One ride = one payment (payments.ride_id UNIQUE), so a prior ride_debit
// ledger row for this ride means we already paid — return true without
// re-debiting. Insufficient balance returns false: the caller leaves the
// payment 'pending' and the app offers retry (online / wallet / cash).
export async function payFromUserWallet(
  rideId: bigint,
  userId: bigint,
  amount: number
): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO user_wallets (user_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    )

    const walletRes = await client.query(
      `SELECT id, balance FROM user_wallets WHERE user_id = $1 FOR UPDATE`,
      [userId]
    )
    const wallet = walletRes.rows[0]

    const dupe = await client.query(
      `SELECT id FROM user_wallet_ledger
       WHERE ride_id = $1 AND entry_type = 'ride_debit' LIMIT 1`,
      [rideId]
    )
    if ((dupe.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK')
      return true
    }

    const balance = parseFloat(wallet.balance)
    if (balance < amount) {
      await client.query('ROLLBACK')
      return false
    }

    const newBalance = Math.round((balance - amount) * 100) / 100

    await client.query(
      `UPDATE user_wallets
       SET balance = $2, lifetime_spent = lifetime_spent + $3
       WHERE id = $1`,
      [wallet.id, newBalance, amount]
    )

    await client.query(
      `INSERT INTO user_wallet_ledger (
         wallet_id, user_id, entry_type,
         amount, direction, balance_after, ride_id, note
       ) VALUES ($1,$2,'ride_debit',$3,'debit',$4,$5,$6)`,
      [wallet.id, userId, amount, newBalance, rideId, `Ride payment for ride #${rideId}`]
    )

    await client.query('COMMIT')
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Build a PayU hosted-checkout form for an online ride payment ──
// Returns the signed form for the client to POST, or null in dev (no PayU
// keys) after auto-confirming — same dev shortcut the driver wallet top-up
// uses so the online flow is exercisable without a gateway.
export interface RidePayuOrder { payu: PayuForm; amount: number }

export async function createRidePaymentOrder(
  rideId: bigint,
  userId: bigint,
  amount: number
): Promise<RidePayuOrder | null> {
  if (!payuConfigured()) {
    // Dev mode: no PayU keys — auto-confirm so the online-payment flow is
    // exercisable without a gateway. Production refuses to boot in this state
    // (see envSchemaChecked) so this can never give away real rides.
    await confirmRidePayment(rideId)
    return null
  }

  const userRes = await pool.query(`SELECT name, email, phone FROM users WHERE id = $1`, [userId])
  const txnId = newTxnId('R', rideId)
  const payu = buildPayuForm({
    txnId, amount,
    productInfo: `Ocar ride ${rideId}`,
    customer: customerFor(userRes.rows[0] ?? {}, 'user', userId),
    returnUrl: `${config.API_BASE_URL}${PAYU_RETURN_PATH}`,
  })

  // Overwrites any earlier txn from a retry. A capture on the superseded txn is
  // caught by handlePayuNotification's unknown-txn path (Task 7).
  await pool.query(
    `UPDATE payments SET gateway = 'payu', gateway_txn_id = $2 WHERE ride_id = $1`,
    [rideId, txnId]
  )
  return { payu, amount }
}

// ── Client-driven verify (primary confirmation path) ───────────
// Mirrors the proven driver wallet-topup verify (payments.routes.ts). Never
// trusts client input: signature verified with our secret, payment re-fetched
// from Razorpay, and the captured amount compared to the fare we stored. All
// failures throw a safe-message error (no error.message leak) with an
// httpStatus, handled by the shared error middleware.
export async function verifyRidePayment(
  rideId: bigint,
  userId: bigint,
  input: { orderId: string; paymentId: string; signature: string }
): Promise<void> {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
    throw Object.assign(new Error('Payment verification is not configured'), { httpStatus: 400 })
  }

  // The order must have been created for this user (bound at order creation) —
  // stops a paymentId/signature tuple for one user's order being replayed
  // against a different user's account.
  const boundUserId = await redis.get(ridePaymentOrderKey(input.orderId))
  if (boundUserId !== userId.toString()) {
    throw Object.assign(new Error('Order does not belong to this user'), { httpStatus: 400 })
  }

  // ...and it must be the order recorded for THIS ride's payment (stops
  // replaying a valid order/signature against an unrelated ride).
  const payRes = await pool.query(
    `SELECT amount, razorpay_order_id FROM payments WHERE ride_id = $1`,
    [rideId]
  )
  const payment = payRes.rows[0]
  if (!payment || payment.razorpay_order_id !== input.orderId) {
    throw Object.assign(new Error('Payment not found for this ride'), { httpStatus: 404 })
  }

  if (!verifyHmacSignature(config.RAZORPAY_KEY_SECRET, `${input.orderId}|${input.paymentId}`, input.signature)) {
    throw Object.assign(new Error('Invalid payment signature'), { httpStatus: 400 })
  }

  // Never trust the client-supplied amount — re-fetch straight from Razorpay
  // and compare against the fare we stored server-side.
  const Razorpay = (await import('razorpay')).default
  const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })
  const rp = await (rzp.payments.fetch as Function)(input.paymentId) as {
    order_id: string; status: string; amount: number
  }
  const expectedPaise = Math.round(parseFloat(payment.amount) * 100)
  if (rp.order_id !== input.orderId || rp.status !== 'captured' || rp.amount !== expectedPaise) {
    throw Object.assign(new Error('Payment not verified'), { httpStatus: 400 })
  }

  await confirmRidePayment(rideId, input.paymentId)
  await redis.del(ridePaymentOrderKey(input.orderId))
}

// ── Retry a stranded ride payment (rider-initiated) ────────────
// Same-channel retry for a payment stuck 'pending'/'failed'. Resets the row and
// re-runs the channel's EXISTING flow — online: createRidePaymentOrder (fresh
// order, client reopens Checkout, confirmed via verify/webhook/reconcile);
// wallet: payFromUserWallet then confirmRidePayment. No new confirmation path:
// confirmRidePayment's WHERE status='pending' guard stays the single idempotency
// lock. The reset itself is guarded so a payment a concurrent path just
// completed is never dragged back to 'pending'.
export type RetryRidePaymentResult =
  | { channel: 'online'; order: RidePayuOrder | null }
  | { channel: 'wallet'; paid: boolean }

export async function retryRidePayment(
  rideId: bigint,
  userId: bigint
): Promise<RetryRidePaymentResult> {
  const payRes = await pool.query(
    `SELECT user_id, channel, status, amount, gateway, gateway_txn_id FROM payments WHERE ride_id = $1`,
    [rideId]
  )
  const payment = payRes.rows[0]
  if (!payment) throw Object.assign(new Error('Payment not found for this ride'), { httpStatus: 404 })
  if (String(payment.user_id) !== userId.toString()) {
    throw Object.assign(new Error('Payment does not belong to this user'), { httpStatus: 403 })
  }

  const retryable = payment.channel === 'razorpay_online' || payment.channel === 'payu_online' || payment.channel === 'platform_wallet'
  const resettable = payment.status === 'pending' || payment.status === 'failed'
  if (!retryable || !resettable) {
    throw Object.assign(new Error('Payment is not eligible for retry'), { httpStatus: 400 })
  }

  // Retrying mints a new txnid and overwrites the stored one, which would
  // orphan a capture still landing on the old txn (rider charged twice). Ask
  // PayU first; refuse while it is captured/in flight. Before the reset, so a
  // refused retry leaves the row untouched.
  if (payment.gateway === 'payu' && payment.gateway_txn_id && payuConfigured()) {
    let prev: PayuStatus
    try {
      prev = await fetchPayuStatus(String(payment.gateway_txn_id))
    } catch (err) {
      log.error({ err, rideId: rideId.toString() }, 'retry: PayU status check failed — refusing retry')
      throw Object.assign(new Error('Could not check your previous payment. Please try again shortly.'), { httpStatus: 503 })
    }
    if (prev.state === 'captured') {
      throw Object.assign(new Error('Payment is already being confirmed'), { httpStatus: 409 })
    }
    if (prev.state === 'pending') {
      throw Object.assign(new Error('Your previous payment is still being processed. Please wait a few minutes.'), { httpStatus: 409 })
    }
    // failed / unknown → safe to mint a new txn
  }

  const amount = parseFloat(payment.amount)

  // Guarded reset: 0 rows means a concurrent verify/webhook already completed it.
  const reset = await pool.query(
    `UPDATE payments SET status='pending', failed_at=NULL, failure_reason=NULL
     WHERE ride_id = $1 AND status IN ('pending','failed')`,
    [rideId]
  )
  const alreadySettled = (reset.rowCount ?? 0) === 0

  if (payment.channel === 'razorpay_online' || payment.channel === 'payu_online') {
    if (alreadySettled) return { channel: 'online', order: null }
    const order = await createRidePaymentOrder(rideId, userId, amount)
    return { channel: 'online', order }
  }

  // platform_wallet
  if (alreadySettled) return { channel: 'wallet', paid: true }
  const paid = await payFromUserWallet(rideId, userId, amount)
  if (paid) await confirmRidePayment(rideId)
  return { channel: 'wallet', paid }
}

// ── Wallet queries ─────────────────────────────────────────────

export async function getDriverWallet(driverId: bigint) {
  const res = await pool.query(
    `SELECT dw.*,
       (SELECT json_agg(l ORDER BY l.created_at DESC)
        FROM (
          SELECT id, entry_type, amount, direction, balance_after,
                 ride_id, note, status, created_at
          FROM driver_wallet_ledger
          WHERE driver_id = $1
          ORDER BY created_at DESC
          LIMIT 20
        ) l) AS recent_ledger
     FROM driver_wallets dw
     WHERE dw.driver_id = $1`,
    [driverId]
  )
  return res.rows[0] ?? null
}

export async function getUserWallet(userId: bigint) {
  const res = await pool.query(
    `SELECT uw.*,
       (SELECT json_agg(l ORDER BY l.created_at DESC)
        FROM (
          SELECT id, entry_type, amount, direction, balance_after,
                 ride_id, expires_at, note, status, created_at
          FROM user_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 20
        ) l) AS recent_ledger
     FROM user_wallets uw
     WHERE uw.user_id = $1`,
    [userId]
  )
  return res.rows[0] ?? null
}

// ── Driver wallet top-up ───────────────────────────────────────

export async function topUpDriverWallet(
  driverId: bigint,
  amount: number,
  referenceId: string
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_wallets (driver_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (driver_id) DO NOTHING`,
      [driverId]
    )

    const walletRes = await client.query(
      `SELECT id, balance FROM driver_wallets WHERE driver_id = $1 FOR UPDATE`,
      [driverId]
    )

    const wallet = walletRes.rows[0]

    // Idempotency: a replayed orderId/paymentId/signature must not credit twice.
    const dupe = await client.query(
      `SELECT id FROM driver_wallet_ledger WHERE wallet_id = $1 AND reference_id = $2 LIMIT 1`,
      [wallet.id, referenceId]
    )
    if ((dupe.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK')
      return
    }

    const prevBalance = parseFloat(wallet.balance)
    const newBalance = Math.round((prevBalance + amount) * 100) / 100

    // Debt-first allocation: a negative balance means the driver owes the
    // platform (dues). balance is a single signed column, so `prevBalance + amount`
    // already zeroes the debt before any remainder becomes spendable — this makes
    // that split explicit and auditable in the ledger note instead of hiding it.
    const debtCleared = prevBalance < 0 ? Math.min(amount, -prevBalance) : 0
    const spendable = Math.round((amount - debtCleared) * 100) / 100
    const note = debtCleared > 0
      ? `Wallet top-up ₹${amount} (₹${debtCleared} cleared dues, ₹${spendable} spendable)`
      : 'Wallet top-up'

    await client.query(
      `UPDATE driver_wallets
       SET balance = $2,
           lifetime_topup = lifetime_topup + $3
       WHERE id = $1`,
      [wallet.id, newBalance, amount]
    )

    await client.query(
      `INSERT INTO driver_wallet_ledger (
         wallet_id, driver_id, entry_type,
         amount, direction, balance_after, reference_id, note
       ) VALUES ($1,$2,'topup',$3,'credit',$4,$5,$6)`,
      [wallet.id, driverId, amount, newBalance, referenceId, note]
    )

    // Ride eligibility is re-derived live from balance on every go-online/
    // matching check — nothing to "reactivate" here. drivers.status is
    // driver-lifecycle state owned by admin/vehicle/onboarding flows, not
    // wallet events (see deductCommission).

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Razorpay webhook handler (backstop confirmation) ────────────
// Primary confirmation is the client-driven verify() (Task 8). This handler
// is a backstop for when the client never calls verify (app killed / network
// drop right after ride completion): if Razorpay tells us a payment captured,
// we confirm it ourselves. confirmRidePayment's WHERE status='pending' guard
// makes this a safe no-op if verify already ran.
//
// Only Razorpay dotted event names we map to a real `gateway_event_type` enum
// value are logged — the old code inserted the raw event string (or the
// literal 'unknown') into that enum column, neither of which is a valid enum
// value, so every insert for an unmapped/unknown event was already failing.
// Logging only tracked events keeps the log table consistent with what it can
// actually store; untracked event types simply return early instead of erroring.
// RazorpayX sends payout.* events (driver disbursal, submitted by
// submitProcessingSettlements in settlements.service.ts) to the SAME webhook
// URL as the payment.* events above (ride/wallet collection) — Razorpay only
// lets you configure one webhook URL per account. Both families share the
// dedup-by-razorpay_event_id guard and the gateway_event_type log table.
const GATEWAY_EVENT_TYPE_MAP: Record<string, string> = {
  'order.paid': 'order_created',
  'payment.authorized': 'payment_authorized',
  'payment.captured': 'payment_captured',
  'payment.failed': 'payment_failed',
  'payout.processed': 'payout_processed',
  'payout.failed': 'payout_failed',
  'payout.reversed': 'payout_reversed',
}

export async function handleWebhookEvent(
  payload: Record<string, unknown>
): Promise<void> {
  const event = (payload as { event?: string }).event
  const eventType = event ? GATEWAY_EVENT_TYPE_MAP[event] : undefined
  if (!eventType) return

  const isPayoutEvent = event?.startsWith('payout.') ?? false
  const entity = isPayoutEvent
    ? (
        payload as { payload?: { payout?: { entity?: {
          id?: string; reference_id?: string; utr?: string; failure_reason?: string
        } } } }
      )?.payload?.payout?.entity
    : (
        payload as { payload?: { payment?: { entity?: { id?: string; order_id?: string } } } }
      )?.payload?.payment?.entity
  const eventId = entity?.id

  if (!eventId) return

  // reference_id was set by submitProcessingSettlements as `${settlementId}:${driverId}`.
  // Validate the format BEFORE marking the event processed below: a
  // malformed/unrelated reference_id (e.g. a payout created manually in the
  // RazorpayX dashboard, not matching our convention) must not be recorded
  // as processed, or a corrected/retried webhook delivery would be silently
  // swallowed forever by the dedup check with no way to recover.
  let settlementId: string | undefined
  if (isPayoutEvent) {
    const referenceId = (entity as { reference_id?: string }).reference_id
    settlementId = referenceId?.split(':')[0]
    if (!settlementId || !/^\d+$/.test(settlementId)) return
  }

  const existing = await pool.query(
    `SELECT id FROM payment_gateway_events WHERE razorpay_event_id = $1`,
    [eventId]
  )
  if (existing.rows.length) return

  await pool.query(
    `INSERT INTO payment_gateway_events
       (event_type, razorpay_event_id, payload, processed, processed_at)
     VALUES ($1,$2,$3,true,now())`,
    [eventType, eventId, JSON.stringify(payload)]
  )

  if (isPayoutEvent) {
    // settlementId already extracted + format-validated above.
    if (event === 'payout.processed') {
      // status != 'completed' guard: Razorpay doesn't guarantee webhook
      // delivery order, so a stale/duplicate event must not clobber a
      // settlement another (later-arriving-but-earlier-fired) event already
      // finalized. razorpay_payout_id guard: only apply this update to the
      // settlement row this specific gateway payout was actually submitted
      // for — reference_id alone isn't proof of that.
      const settlementUpdate = await pool.query(
        `UPDATE settlements SET status = 'completed', completed_at = now(), utr = $2
         WHERE id = $1 AND status != 'completed' AND razorpay_payout_id = $3`,
        [settlementId, (entity as { utr?: string }).utr ?? null, eventId]
      )
      if ((settlementUpdate.rowCount ?? 0) > 0) {
        await pool.query(
          `UPDATE driver_earnings SET status = 'paid' WHERE settlement_id = $1 AND status = 'in_payout'`,
          [settlementId]
        )
      }
      return
    }

    // payout.failed / payout.reversed — same revert path either way. The
    // gateway only fires this for a payout that was actually submitted
    // successfully, so settlements.razorpay_payout_id already holds the real
    // gateway payout id here (not the pre-submit placeholder) — nothing to
    // reset on that column.
    const rawFailureReason = (entity as { failure_reason?: string }).failure_reason
    const failureCode = mapPayoutFailureCode(rawFailureReason)
    // Raw gateway reason stays in structured logs only, never in a returned column.
    log.warn({ settlementId, rawFailureReason, event }, 'settlement payout failed (webhook)')
    const settlementUpdate = await pool.query(
      `UPDATE settlements SET status = 'failed', failed_at = now(), failure_code = $2
       WHERE id = $1 AND status != 'completed' AND razorpay_payout_id = $3`,
      [settlementId, failureCode, eventId]
    )
    if ((settlementUpdate.rowCount ?? 0) > 0) {
      await pool.query(
        `UPDATE driver_earnings SET status = 'cleared', settlement_id = NULL
         WHERE settlement_id = $1 AND status = 'in_payout'`,
        [settlementId]
      )
    }
    return
  }

  if (event === 'payment.captured' && (entity as { order_id?: string })?.order_id) {
    const orderId = (entity as { order_id?: string }).order_id!

    const pendingRes = await pool.query(
      `SELECT ride_id FROM payments WHERE razorpay_order_id = $1 AND status = 'pending'`,
      [orderId]
    )
    const pending = pendingRes.rows[0]
    if (pending) {
      await confirmRidePayment(BigInt(pending.ride_id), eventId)
      return
    }

    // Same order_id namespace also covers package-purchase orders (Task 9).
    // eventId doubles as the Razorpay payment id here (see entity?.id above).
    // findPendingPurchaseByOrderId is just a cheap existence check to skip the
    // UPDATE below for unmatched orders — its result is NOT trusted for the
    // actual credit values. markPurchaseCompleted does the real atomic
    // claim-and-check (WHERE status='pending' inside the UPDATE itself), so
    // concurrent webhook deliveries for the same order can only have one
    // winner; only the winner's RETURNING row is used to credit the wallet.
    const packagePurchase = await packagesRepo.findPendingPurchaseByOrderId(orderId)
    if (packagePurchase) {
      const claimed = await packagesRepo.markPurchaseCompleted(packagePurchase.id, eventId)
      if (claimed) {
        await packagesService.creditPackageBalance(
          BigInt(claimed.driver_id),
          parseFloat(claimed.threshold_value),
          eventId
        )
      }
    }
  }
}

// ── PayU notification funnel (browser return + webhook) ─────────
// Both entry points land here. Order of trust: (1) response hash proves the
// callback came from PayU un-tampered; (2) verify_payment proves the actual
// state + captured amount — the posted status/amount are never used to move
// money; (3) the existing idempotent confirm paths do the crediting, so a
// return + webhook race, or a repeated webhook, credits at most once.
// Only a bad hash throws. Any other failure degrades to 'pending' with
// error: true, so the return route still redirects the rider/driver and the
// webhook route answers non-2xx and PayU retries it (reconcile is the backstop).
export type PayuKind = 'ride' | 'wallet' | 'package' | 'unknown'
export interface PayuOutcome {
  kind: PayuKind
  id: string | null
  result: 'success' | 'failed' | 'pending'
  error?: true
}

// Card/VPA-adjacent fields never reach the log table — keep an allowlist.
const PAYU_LOG_FIELDS = ['txnid', 'mihpayid', 'status', 'unmappedstatus', 'amount', 'mode', 'bank_ref_num', 'error', 'error_Message']

// Audit row only — best-effort, never throws: a failed insert after money has
// already moved must not turn a confirmed payment into an error.
async function recordPayuEvent(
  body: Record<string, string>,
  status: PayuStatus,
  processed: boolean,
  note: string
): Promise<void> {
  try {
    // No mihpayid anywhere → txnid, so unrelated txns never share one dedupe key.
    const ref = status.mihpayid ?? body['mihpayid'] ?? body['txnid'] ?? 'none'
    const eventId = `${ref}:${status.state}`.slice(0, 80)
    const payload: Record<string, string> = { note }
    for (const k of PAYU_LOG_FIELDS) if (body[k] !== undefined) payload[k] = body[k]!
    await pool.query(
      `INSERT INTO payment_gateway_events
         (event_type, gateway_event_id, payload, processed, processed_at)
       VALUES ($1,$2,$3,${processed ? 'true' : 'false'},${processed ? 'now()' : 'NULL'})
       ON CONFLICT (gateway_event_id) WHERE gateway_event_id IS NOT NULL DO NOTHING`,
      [status.state === 'captured' ? 'payment_captured' : 'payment_failed', eventId, JSON.stringify(payload)]
    )
  } catch (err) {
    log.error({ err, txnId: body['txnid'], note }, 'PayU audit event insert failed')
  }
}

// Lazy import: the metrics module pulls in pool + queues at load time.
async function countUnattributedCapture(
  reason: 'unknown_txn' | 'amount_mismatch' | 'duplicate_capture' | 'confirm_lost_race'
): Promise<void> {
  try {
    const { payuUnattributedCapturesTotal } = await import('@/observability/metrics')
    payuUnattributedCapturesTotal.inc({ reason })
  } catch (err) {
    log.error({ err, reason }, 'payu_unattributed_captures_total increment failed')
  }
}

export async function handlePayuNotification(body: Record<string, string>): Promise<PayuOutcome> {
  if (!verifyPayuResponseHash(body)) {
    throw Object.assign(new Error('Invalid signature'), { httpStatus: 400, appCode: 'WEBHOOK_INVALID_SIGNATURE' })
  }
  return settlePayuTxn(body['txnid'] ?? '', body)
}

// Wallet top-up attribution: Redis binding (fast path), else the durable
// wallet_topup_orders row — survives the 24h TTL and a Redis flush.
async function resolveTopupBinding(txnId: string): Promise<TopupBinding | null> {
  const raw = await redis.get(walletTopupOrderKey(txnId))
  if (raw) return JSON.parse(raw) as TopupBinding
  const res = await pool.query(
    `SELECT driver_id, amount, status FROM wallet_topup_orders WHERE gateway_txn_id = $1`, [txnId]
  )
  const row = res.rows[0] as { driver_id: string; amount: string } | undefined
  return row ? { driverId: String(row.driver_id), amountPaise: toPaise(String(row.amount)) } : null
}

// Everything after the hash check. Callers: handlePayuNotification (hash-verified
// callback) and reconcilePendingPayuPurchases (txnid read from our own DB; no hash
// exists there). Trust comes from verify_payment either way — auditBody is only
// what gets written to the audit table.
export async function settlePayuTxn(txnId: string, auditBody: Record<string, string>): Promise<PayuOutcome> {
  let kind: PayuKind = 'unknown'
  let id: string | null = null

  try {
    // Resolve what this txn pays for BEFORE calling PayU, so a failed API call
    // still lets the caller redirect to the right place.
    const rideRes = await pool.query(
      `SELECT ride_id, amount, status FROM payments WHERE gateway_txn_id = $1`, [txnId]
    )
    const ride = rideRes.rows[0] as { ride_id: string; amount: string; status: string } | undefined
    const pkg = ride ? null : await packagesRepo.findPurchaseByTxnId(txnId)
    const binding = ride || pkg ? null : await resolveTopupBinding(txnId)

    kind = ride ? 'ride' : pkg ? 'package' : binding ? 'wallet' : 'unknown'
    id = ride ? String(ride.ride_id) : pkg ? String(pkg.driver_id) : binding ? binding.driverId : null

    // A throw here (timeout, HTTP 5xx) is an infra failure → pending + error below.
    const status = await fetchPayuStatus(txnId)

    if (status.state === 'failed') return { kind, id, result: 'failed' }
    if (status.state !== 'captured') return { kind, id, result: 'pending' }

    const paymentId = status.mihpayid ?? txnId
    const expectedPaise =
      ride ? toPaise(ride.amount) : pkg ? toPaise(pkg.amount) : binding ? binding.amountPaise : null

    // Money is captured at PayU but we cannot attribute it (superseded retry txn,
    // expired top-up binding): never guess an owner — flag for manual refund.
    if (expectedPaise === null) {
      log.error({ txnId, mihpayid: status.mihpayid, amountPaise: status.amountPaise }, 'PayU capture for unknown txn — needs manual review/refund')
      await countUnattributedCapture('unknown_txn')
      await recordPayuEvent(auditBody, status, false, 'unknown txn captured')
      return { kind: 'unknown', id: null, result: 'pending' }
    }
    // expectedPaise <= 0: fetchPayuStatus reports 0 when PayU omits amt, so a
    // zero/negative expectation could "match" a missing amount — never confirm it.
    if (expectedPaise <= 0 || status.amountPaise !== expectedPaise) {
      log.error({ txnId, expectedPaise, capturedPaise: status.amountPaise }, 'PayU captured amount differs from stored amount — not confirmed')
      await countUnattributedCapture('amount_mismatch')
      await recordPayuEvent(auditBody, status, false, 'amount mismatch')
      return { kind, id, result: 'pending' }
    }

    if (ride) {
      const rideId = BigInt(ride.ride_id)
      if (ride.status === 'failed') {
        // Reconcile (or an earlier failed callback) failed this row while the rider
        // was still paying; the capture is real, so reopen it for the guarded confirm.
        await pool.query(
          `UPDATE payments SET status = 'pending', failed_at = NULL, failure_reason = NULL
           WHERE ride_id = $1 AND status = 'failed'`,
          [rideId]
        )
      }
      if (!(await confirmRidePayment(rideId, paymentId, 'payu'))) {
        // The guarded UPDATE matched nothing. Only a row settled by THIS capture
        // is a replay (return + webhook race, repeated webhook). Anything else is
        // captured money we did not credit: settled by another payment (retry
        // race → double charge) or re-failed by the sweep between revive and
        // confirm. Not retryable — flag for manual refund.
        const cur = await pool.query(
          `SELECT status, gateway_payment_id FROM payments WHERE ride_id = $1`, [rideId]
        )
        const row = cur.rows[0] as { status: string; gateway_payment_id: string | null } | undefined
        if (!(row?.status === 'completed' && row.gateway_payment_id === paymentId)) {
          const reason = row?.status === 'completed' ? 'duplicate_capture' : 'confirm_lost_race'
          log.error({ txnId, rideId: ride.ride_id, mihpayid: status.mihpayid, rowStatus: row?.status ?? null, reason },
            'PayU capture on a ride payment it did not settle — needs manual review/refund')
          await countUnattributedCapture(reason)
          await recordPayuEvent(auditBody, status, false, 'capture on settled ride')
          return { kind, id, result: 'pending' }
        }
      }
    } else if (pkg) {
      const claimed = await packagesRepo.markPurchaseCompletedPayu(pkg.id, paymentId)
      if (claimed) {
        await packagesService.creditPackageBalance(BigInt(claimed.driver_id), parseFloat(claimed.threshold_value), paymentId)
      } else {
        // Claim already won (replay, or a previous attempt whose credit threw
        // after the claim committed). Re-run the credit with the payment id the
        // claim stored: creditPackageBalance dedupes on it, so this credits only
        // if the earlier credit never landed.
        const cur = await packagesRepo.findPurchaseByTxnId(txnId)
        if (cur?.status === 'completed' && cur.gateway_payment_id) {
          await packagesService.creditPackageBalance(BigInt(cur.driver_id), parseFloat(cur.threshold_value), cur.gateway_payment_id)
        }
      }
    } else if (binding) {
      // reference_id = txnid: topUpDriverWallet dedupes on (wallet, reference_id)
      // under a row lock, so return + webhook racing credit once. The Redis binding
      // is left to expire (not deleted) so the slower of the two still resolves it.
      await topUpDriverWallet(BigInt(binding.driverId), expectedPaise / 100, txnId)
      // Best-effort: this flag only stops the sweep re-polling the txn; the
      // ledger dedupe above is the double-credit guard.
      try {
        await pool.query(
          `UPDATE wallet_topup_orders SET status = 'completed', completed_at = now()
           WHERE gateway_txn_id = $1 AND status = 'pending'`,
          [txnId]
        )
      } catch (err) {
        log.error({ err, txnId }, 'wallet_topup_orders completed-flag update failed')
      }
    }

    await recordPayuEvent(auditBody, status, true, 'confirmed')
    return { kind, id, result: 'success' }
  } catch (err) {
    // Never log the body (hash, PII) or config — txn id + resolved target only.
    log.error({ err, txnId, kind, id }, 'PayU notification processing failed — left for webhook retry/reconcile')
    return { kind, id, result: 'pending', error: true }
  }
}

// ── Reconciliation sweep (app-killed-before-verify safety net) ──
// Pending online payments older than the grace window are rechecked directly
// against the gateway. Captured → same confirm funnel. Not captured → failed
// (guarded on status='pending' so a payment another path already confirmed is
// never overwritten). Ride stays completed either way.
// PayU: `failed` fails immediately; `unknown`/`pending` are left alone until the
// row is 60+ min old, and then only `unknown` is failed (`pending` never is).
export async function reconcilePendingRidePayments(): Promise<void> {
  const razorpayOn = Boolean(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET)
  if (!razorpayOn && !payuConfigured()) return

  // updated_at, not created_at: retry/initiate bump it, so a rider who retried
  // (or is still on PayU's page) is not failed out from under themselves.
  // random(), not oldest-first: rows a sweep leaves untouched (PayU pending,
  // young unknown, amount mismatch) keep their old updated_at and would
  // otherwise fill every batch and starve newer rows.
  const res = await pool.query(
    `SELECT ride_id, razorpay_order_id, gateway, gateway_txn_id, user_id, amount,
            (updated_at < now() - interval '60 minutes') AS stale_60m
     FROM payments
     WHERE status = 'pending'
       AND (razorpay_order_id IS NOT NULL OR gateway_txn_id IS NOT NULL)
       AND updated_at < now() - interval '10 minutes'
     ORDER BY random()
     LIMIT 50`
  )
  if (res.rows.length === 0) return
  if (res.rows.length === 50) log.warn({ count: res.rows.length }, 'reconcile: batch full — pending backlog exceeds one sweep')

  const failAndNotify = async (row: { ride_id: string; user_id: string; amount: string }) => {
    const upd = await pool.query(
      `UPDATE payments
         SET status = 'failed', failed_at = now(), failure_reason = 'reconciliation_no_capture'
       WHERE ride_id = $1 AND status = 'pending'`,
      [BigInt(row.ride_id)]
    )
    // Only notify if we actually flipped it to failed — a payment another
    // path (verify/webhook) confirmed in the meantime hits 0 rows here.
    // Lazy import: this module is imported broadly, and its transitive
    // chain (socket.server → rides.service → jobs/queues) shouldn't load
    // eagerly for every consumer of payments.service.ts.
    if ((upd.rowCount ?? 0) > 0) {
      const { notifyRidePaymentFailed } = await import('@/modules/notifications/notifications.service')
      await notifyRidePaymentFailed(BigInt(row.user_id), BigInt(row.ride_id), parseFloat(row.amount))
    }
  }

  // Constructed only when Razorpay rows exist, so PayU-only deployments never load the SDK.
  let rzp: import('razorpay') | null = null
  if (razorpayOn && res.rows.some(r => r.gateway !== 'payu')) {
    const Razorpay = (await import('razorpay')).default
    rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID!, key_secret: config.RAZORPAY_KEY_SECRET! })
  }

  for (const row of res.rows) {
    try {
      if (row.gateway === 'payu') {
        if (!payuConfigured()) continue
        const st = await fetchPayuStatus(row.gateway_txn_id as string)
        if (st.state === 'captured') {
          if (st.amountPaise === toPaise(String(row.amount))) {
            await confirmRidePayment(BigInt(row.ride_id), st.mihpayid ?? (row.gateway_txn_id as string), 'payu')
          } else {
            await countUnattributedCapture('amount_mismatch')
            log.error({ rideId: row.ride_id, expected: row.amount, capturedPaise: st.amountPaise }, 'reconcile: PayU amount mismatch — not confirmed')
          }
        } else if (st.state === 'failed' || (st.state === 'unknown' && row.stale_60m)) {
          await failAndNotify(row)
        } // pending / young unknown: rider may still be on PayU's page — next sweep decides
        continue
      }

      if (!rzp) continue
      const orderId = row.razorpay_order_id as string
      const list = await (rzp.orders.fetchPayments as Function)(orderId) as {
        items: Array<{ id: string; status: string }>
      }
      const captured = list.items.find(p => p.status === 'captured')
      if (captured) {
        await confirmRidePayment(BigInt(row.ride_id), captured.id)
      } else {
        await failAndNotify(row)
      }
    } catch (err) {
      log.error({ err, rideId: row.ride_id }, 'payment reconcile failed')
    }
  }
}

// ── PayU purchase/top-up sweep (missed webhook + driver closed the tab) ──
// Pending package purchases and wallet top-ups are re-run through the same
// settler the callbacks use; verify_payment decides. Non-captured states leave
// the row untouched, and rows older than 3 days are never marked failed — a
// failed row could not be credited if PayU later reports a capture.
// random(): see reconcilePendingRidePayments (untouched rows would starve newer ones).
export async function reconcilePendingPayuPurchases(): Promise<void> {
  if (!payuConfigured()) return
  const res = await pool.query(
    `SELECT gateway_txn_id FROM (
       SELECT gateway_txn_id FROM package_purchase_orders
        WHERE gateway = 'payu' AND gateway_txn_id IS NOT NULL AND status = 'pending'
          AND created_at < now() - interval '10 minutes'
          AND created_at > now() - interval '3 days'
       UNION ALL
       SELECT gateway_txn_id FROM wallet_topup_orders
        WHERE status = 'pending'
          AND created_at < now() - interval '10 minutes'
          AND created_at > now() - interval '3 days'
     ) t
     ORDER BY random()
     LIMIT 50`
  )
  if (res.rows.length === 50) log.warn({ count: res.rows.length }, 'payu purchase reconcile: batch full — pending backlog exceeds one sweep')
  for (const row of res.rows as Array<{ gateway_txn_id: string }>) {
    const txnId = row.gateway_txn_id
    try {
      await settlePayuTxn(txnId, { txnid: txnId })
    } catch (err) {
      log.error({ err, txnId }, 'payu purchase reconcile failed')
    }
  }
}

// ── Admin: list payments ───────────────────────────────────────

export async function listPayments(opts: {
  status?: string
  limit: number
  offset: number
}) {
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.status) {
    params.push(opts.status)
    conditions.push(`p.status = $${params.length}`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  params.push(opts.limit, opts.offset)

  const res = await pool.query(
    `SELECT p.id, p.ride_id, p.amount, p.channel, p.status,
            p.commission_percent, p.commission_amount, p.driver_earning,
            p.captured_at, p.created_at,
            r.origin_address, r.destination_address,
            u.name AS user_name, u.phone AS user_phone,
            d.full_name AS driver_name, d.phone AS driver_phone
     FROM payments p
     JOIN rides r ON r.id = p.ride_id
     JOIN users u ON u.id = p.user_id
     JOIN drivers d ON d.id = p.driver_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )

  const countRes = await pool.query(
    `SELECT COUNT(*) AS total FROM payments p ${where}`,
    params.slice(0, -2)
  )

  return {
    payments: res.rows,
    total: parseInt(countRes.rows[0]?.total ?? '0'),
  }
}

export async function getPaymentStats() {
  const res = await pool.query(
    `SELECT
       COALESCE(SUM(amount), 0)            AS total_revenue,
       COALESCE(SUM(commission_amount), 0) AS total_commission,
       COALESCE(SUM(driver_earning), 0)    AS total_driver_earnings,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending_count
     FROM payments`
  )
  return res.rows[0]
}
