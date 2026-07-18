import { pool } from '@/db/client'

// ── Config helpers ─────────────────────────────────────────────

async function getConfigValue(key: string, fallback: string): Promise<string> {
  const res = await pool.query(
    `SELECT value FROM system_config WHERE key = $1 AND status = 'active'`,
    [key]
  )
  return res.rows[0]?.value ?? fallback
}

async function getCommissionPercent(): Promise<number> {
  return parseFloat(await getConfigValue('commission_percent', '15'))
}

async function getMinWalletBalance(): Promise<number> {
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
    const newBalance = Math.max(
      Math.round((currentBalance - commission) * 100) / 100,
      0
    )

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

    // Low balance is handled at go-online time (blocks going online) — no suspension here

    await client.query('COMMIT')
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

    const minBalance = await getMinWalletBalance()
    if (newBalance >= minBalance) {
      await client.query(
        `UPDATE drivers
         SET status = 'active', updated_at = now()
         WHERE id = $1 AND status = 'suspended'`,
        [driverId]
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Razorpay webhook handler (Phase 2 stub) ────────────────────

export async function handleWebhookEvent(
  payload: Record<string, unknown>
): Promise<void> {
  const eventId = (payload as { payload?: { payment?: { entity?: { id?: string } } } })
    ?.payload?.payment?.entity?.id

  if (!eventId) return

  const existing = await pool.query(
    `SELECT id FROM payment_gateway_events WHERE razorpay_event_id = $1`,
    [eventId]
  )
  if (existing.rows.length) return

  await pool.query(
    `INSERT INTO payment_gateway_events
       (event_type, razorpay_event_id, payload, processed, processed_at)
     VALUES ($1,$2,$3,true,now())`,
    [
      (payload as { event?: string }).event ?? 'unknown',
      eventId,
      JSON.stringify(payload),
    ]
  )
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
