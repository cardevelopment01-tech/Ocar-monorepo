import { pool } from '@/db/client'
import { config } from '@/config'
import { client as redis } from '@/db/redis'
import { ridePaymentOrderKey } from '@/constants/redis-keys'
import { notifyDriverLowWalletBalance } from '@/modules/notifications/notifications.service'
import { accrueDriverEarning } from '@/modules/payments/submodules/settlements/settlements.service'
import { getConfigValue } from '@/lib/system-config'
import { logger } from '@/lib/logger'

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
  driverId: bigint
): Promise<void> {
  const payRes = await pool.query(
    `SELECT commission_amount FROM payments WHERE ride_id = $1`,
    [rideId]
  )
  const payment = payRes.rows[0]
  if (!payment) return

  const commission = parseFloat(payment.commission_amount)
  const minBalance = await getMinWalletBalance()

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
      `SELECT id, balance, is_frozen
       FROM driver_wallets
       WHERE driver_id = $1
       FOR UPDATE`,
      [driverId]
    )

    const wallet = walletRes.rows[0]
    if (!wallet || wallet.is_frozen) {
      await client.query('ROLLBACK')
      return
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

    await client.query('COMMIT')

    if (justCrossedBelowMin) {
      try {
        await notifyDriverLowWalletBalance(driverId, newBalance, minBalance)
      } catch (err) {
        log.error({ err }, 'low-balance notify failed')
      }
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── User cashback ──────────────────────────────────────────────

export async function creditCashback(
  rideId: bigint,
  userId: bigint,
  fareAmount: number
): Promise<void> {
  const cashbackPct = await getCashbackPercent()
  const cashbackAmt = Math.round(fareAmount * cashbackPct) / 100
  if (cashbackAmt <= 0) return

  const expiryDays = await getCashbackExpiryDays()

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

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Confirm a collected ride payment (shared by verify/webhook/reconcile) ──
// The `WHERE status='pending'` guard is the idempotency lock: only the first
// caller to flip pending→completed runs commission + cashback. Duplicate or
// stale triggers hit zero rows and return false (no-op). Razorpay does not
// guarantee webhook ordering, so this compare-before-write is mandatory.
export async function confirmRidePayment(
  rideId: bigint,
  razorpayPaymentId?: string
): Promise<boolean> {
  const params: unknown[] = [rideId]
  let extraSet = ''
  if (razorpayPaymentId !== undefined) {
    params.push(razorpayPaymentId)
    extraSet = ', razorpay_payment_id = $2'
  }

  const res = await pool.query(
    `UPDATE payments
       SET status = 'completed', captured_at = now()${extraSet}
     WHERE ride_id = $1 AND status = 'pending'
     RETURNING driver_id, user_id, amount`,
    params
  )

  if ((res.rowCount ?? 0) === 0) return false

  const row = res.rows[0]
  await deductCommission(rideId, BigInt(row.driver_id))
  await accrueDriverEarning(rideId, BigInt(row.driver_id))
  await creditCashback(rideId, BigInt(row.user_id), parseFloat(row.amount))
  return true
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

// ── Create a Razorpay order for an online ride payment ──────────
// Returns the order handle for the client to open Checkout, or null in dev
// (no Razorpay keys) after auto-confirming — same dev shortcut the driver
// wallet top-up uses so the online flow is exercisable without a gateway.
export async function createRidePaymentOrder(
  rideId: bigint,
  userId: bigint,
  amount: number
): Promise<{ orderId: string; key: string; amount: number } | null> {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
    // Dev mode: no Razorpay keys — auto-confirm so the online-payment flow is
    // exercisable without a gateway, mirroring the driver wallet top-up dev path.
    await confirmRidePayment(rideId)
    return null
  }

  const Razorpay = (await import('razorpay')).default
  const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })
  const order = await (rzp.orders.create as Function)({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt: `ride_${rideId}_${Date.now()}`,
  })
  const orderId = (order as { id: string }).id

  await pool.query(
    `UPDATE payments SET razorpay_order_id = $2 WHERE ride_id = $1`,
    [rideId, orderId]
  )
  // Bind this order to the user who created it so /verify (Task 8) can reject
  // a paymentId/signature obtained for one user being replayed by another.
  await redis.set(ridePaymentOrderKey(orderId), userId.toString(), 'EX', 1800)

  return { orderId, key: config.RAZORPAY_KEY_ID, amount }
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

  const { createHmac } = await import('crypto')
  const expected = createHmac('sha256', config.RAZORPAY_KEY_SECRET)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex')
  if (input.signature !== expected) {
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
  | { channel: 'online'; order: { orderId: string; key: string; amount: number } | null }
  | { channel: 'wallet'; paid: boolean }

export async function retryRidePayment(
  rideId: bigint,
  userId: bigint
): Promise<RetryRidePaymentResult> {
  const payRes = await pool.query(
    `SELECT user_id, channel, status, amount FROM payments WHERE ride_id = $1`,
    [rideId]
  )
  const payment = payRes.rows[0]
  if (!payment) throw Object.assign(new Error('Payment not found for this ride'), { httpStatus: 404 })
  if (String(payment.user_id) !== userId.toString()) {
    throw Object.assign(new Error('Payment does not belong to this user'), { httpStatus: 403 })
  }

  const retryable = payment.channel === 'razorpay_online' || payment.channel === 'platform_wallet'
  const resettable = payment.status === 'pending' || payment.status === 'failed'
  if (!retryable || !resettable) {
    throw Object.assign(new Error('Payment is not eligible for retry'), { httpStatus: 400 })
  }

  const amount = parseFloat(payment.amount)

  // Guarded reset: 0 rows means a concurrent verify/webhook already completed it.
  const reset = await pool.query(
    `UPDATE payments SET status='pending', failed_at=NULL, failure_reason=NULL
     WHERE ride_id = $1 AND status IN ('pending','failed')`,
    [rideId]
  )
  const alreadySettled = (reset.rowCount ?? 0) === 0

  if (payment.channel === 'razorpay_online') {
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

    const newBalance = Math.round((parseFloat(wallet.balance) + amount) * 100) / 100

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
       ) VALUES ($1,$2,'topup',$3,'credit',$4,$5,'Wallet top-up via Razorpay')`,
      [wallet.id, driverId, amount, newBalance, referenceId]
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
    const failureReason = (entity as { failure_reason?: string }).failure_reason ?? event
    const settlementUpdate = await pool.query(
      `UPDATE settlements SET status = 'failed', failed_at = now(), failure_reason = $2
       WHERE id = $1 AND status != 'completed' AND razorpay_payout_id = $3`,
      [settlementId, failureReason ?? null, eventId]
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
    const pendingRes = await pool.query(
      `SELECT ride_id FROM payments WHERE razorpay_order_id = $1 AND status = 'pending'`,
      [(entity as { order_id?: string }).order_id]
    )
    const pending = pendingRes.rows[0]
    if (pending) {
      await confirmRidePayment(BigInt(pending.ride_id), eventId)
    }
  }
}

// ── Reconciliation sweep (app-killed-before-verify safety net) ──
// Pending online payments older than the grace window get rechecked directly
// against Razorpay. Captured → same confirm funnel. Not captured → failed
// (guarded on status='pending' so a payment another path already confirmed is
// never overwritten). Ride stays completed either way.
export async function reconcilePendingRidePayments(): Promise<void> {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) return

  const res = await pool.query(
    `SELECT ride_id, razorpay_order_id, user_id, amount
     FROM payments
     WHERE status = 'pending'
       AND razorpay_order_id IS NOT NULL
       AND created_at < now() - interval '10 minutes'`
  )
  if (res.rows.length === 0) return

  const Razorpay = (await import('razorpay')).default
  const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })

  for (const row of res.rows) {
    try {
      const orderId = row.razorpay_order_id as string
      const list = await (rzp.orders.fetchPayments as Function)(orderId) as {
        items: Array<{ id: string; status: string }>
      }
      const captured = list.items.find(p => p.status === 'captured')
      if (captured) {
        await confirmRidePayment(BigInt(row.ride_id), captured.id)
      } else {
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
    } catch (err) {
      log.error({ err, rideId: row.ride_id }, 'payment reconcile failed')
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
