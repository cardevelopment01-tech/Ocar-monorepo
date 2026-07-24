import { pool } from '@/db/client'
import { config } from '@/config'
import { getConfigValue } from '@/lib/system-config'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'

function currentFyQuarter(now: Date): { fy: string; quarter: number } {
  // Indian FY: Apr 1 - Mar 31. Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar.
  const month = now.getUTCMonth() // 0-11
  const fyStartYear = month >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const quarter = [3, 4, 5].includes(month) ? 1
    : [6, 7, 8].includes(month) ? 2
    : [9, 10, 11].includes(month) ? 3
    : 4
  return { fy: `${fyStartYear}-${fyStartYear + 1}`, quarter }
}

// Called once per online/wallet-channel ride, right after commission
// deduction. Cash rides never call this — the driver already holds the
// cash, only commission recovery (existing deductCommission) applies.
export async function accrueDriverEarning(rideId: bigint, driverId: bigint): Promise<void> {
  const payRes = await pool.query(
    `SELECT driver_earning, amount FROM payments WHERE ride_id = $1`,
    [rideId]
  )
  const payment = payRes.rows[0]
  if (!payment) return

  const netEarning = parseFloat(payment.driver_earning)
  const grossFare = parseFloat(payment.amount)
  const holdHours = parseInt(await getConfigValue('payout_hold_hours', '24'))

  const taxRes = await pool.query(
    `SELECT pan_verified FROM driver_tax_profile WHERE driver_id = $1`,
    [driverId]
  )
  const panVerified = taxRes.rows[0]?.pan_verified === true

  const ratesRes = await pool.query(
    `SELECT key, value FROM system_config WHERE key = ANY($1) AND status = 'active'`,
    [['tds_rate_with_pan_pct', 'tds_rate_without_pan_pct']]
  )
  const rates = Object.fromEntries(ratesRes.rows.map((r: { key: string; value: string }) => [r.key, r.value]))
  const ratePct = panVerified
    ? parseFloat(rates['tds_rate_with_pan_pct'] ?? '1')
    : parseFloat(rates['tds_rate_without_pan_pct'] ?? '20')
  const tdsAmount = Math.round(grossFare * ratePct) / 100
  const { fy, quarter } = currentFyQuarter(new Date())

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_earnings (
         driver_id, ride_id, entry_type, amount, status, available_at, idempotency_key, note
       ) VALUES ($1,$2,'ride_fare_net',$3,'pending', now() + ($4 || ' hours')::interval, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [driverId, rideId, netEarning, holdHours, `ride_fare_net:ride:${rideId}`, `Ride fare net for ride #${rideId}`]
    )

    if (tdsAmount > 0) {
      await client.query(
        `INSERT INTO driver_earnings (
           driver_id, ride_id, entry_type, amount, status, available_at, idempotency_key, note
         ) VALUES ($1,$2,'tds_deduction',$3,'pending', now() + ($4 || ' hours')::interval, $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [driverId, rideId, -tdsAmount, holdHours, `tds_deduction:ride:${rideId}`, `194-O TDS @ ${ratePct}% on ride #${rideId}`]
      )

      await client.query(
        `INSERT INTO tax_deductions (
           driver_id, ride_id, section, taxable_base, rate_pct, tds_amount, pan_at_deduction, fy, quarter
         ) VALUES ($1,$2,'194O',$3,$4,$5,
           (SELECT pan_enc FROM driver_tax_profile WHERE driver_id = $1), $6, $7)
         ON CONFLICT (ride_id) DO NOTHING`,
        [driverId, rideId, grossFare, ratePct, tdsAmount, fy, quarter]
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

// Runs every 15 min. A held driver's lines still clear here — holds only
// block the batch sweep (Task 6/7), not visibility of the payable balance.
export async function clearAvailableEarnings(): Promise<void> {
  await pool.query(
    `UPDATE driver_earnings
       SET status = 'cleared'
     WHERE status = 'pending' AND available_at <= now()`
  )
}

// Groups every driver's `cleared` earnings (excluding held drivers, and
// drivers without a verified bank account) into one settlements row per
// driver, all sharing the same period — that shared period IS the "batch";
// no separate batch table. Runs the select-then-insert-then-stamp inside one
// transaction so a line clearing mid-sweep is either fully swept or fully
// left for next time, never double-counted.
export async function runScheduledSettlementBatch(): Promise<void> {
  const autoApproveLimit = parseFloat(await getConfigValue('settlement_auto_approve_limit', '50000'))
  const periodTo = new Date()
  const periodFrom = new Date(periodTo.getTime() - 24 * 60 * 60 * 1000)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Candidate drivers: distinct, no SUM here — the authoritative sum comes
    // from the FOR UPDATE select below, per driver, so it's always the exact
    // set of rows we go on to lock and sweep (never a stale/racing total).
    const candidates = await client.query(
      `SELECT DISTINCT de.driver_id, dba.id AS bank_account_id
       FROM driver_earnings de
       JOIN driver_bank_accounts dba
         ON dba.driver_id = de.driver_id AND dba.is_primary = true AND dba.status = 'verified'
       WHERE de.status = 'cleared'
         AND NOT EXISTS (
           SELECT 1 FROM driver_payout_holds h WHERE h.driver_id = de.driver_id AND h.active
         )`
    )

    // First pass: lock each candidate driver's cleared rows and compute the
    // real total from exactly those locked rows. A concurrent overlapping
    // run's FOR UPDATE on the same driver blocks here until this transaction
    // commits or rolls back, then sees those rows already 'in_payout' —
    // naturally yielding zero rows and zero total, so it correctly skips
    // that driver instead of double-sweeping.
    const perDriver: Array<{ driverId: string; bankAccountId: string; rowIds: string[]; total: number }> = []
    for (const row of candidates.rows) {
      const locked = await client.query(
        `SELECT id, amount FROM driver_earnings
         WHERE driver_id = $1 AND status = 'cleared'
         FOR UPDATE`,
        [row.driver_id]
      )
      const total = locked.rows.reduce((sum: number, r: { amount: string }) => sum + parseFloat(r.amount), 0)
      if (total > 0) {
        perDriver.push({
          driverId: row.driver_id,
          bankAccountId: row.bank_account_id,
          rowIds: locked.rows.map((r: { id: string }) => r.id),
          total,
        })
      }
    }

    const batchTotal = perDriver.reduce((sum, d) => sum + d.total, 0)
    const initialStatus = batchTotal <= autoApproveLimit ? 'processing' : 'pending'

    for (const d of perDriver) {
      const settlementRes = await client.query(
        `INSERT INTO settlements (
           driver_id, period_from, period_to, net_payout, status, run_type, bank_account_id
         ) VALUES ($1,$2,$3,$4,$5,'scheduled',$6)
         RETURNING id`,
        [d.driverId, periodFrom, periodTo, d.total, initialStatus, d.bankAccountId]
      )
      const settlementId = settlementRes.rows[0].id

      // Sweep by explicit id list — the exact rows we locked and summed
      // above, never a fresh WHERE re-evaluation that could pick up a row
      // that cleared after we computed the total.
      await client.query(
        `UPDATE driver_earnings
           SET status = 'in_payout', settlement_id = $2
         WHERE id = ANY($1::bigint[])`,
        [d.rowIds, settlementId]
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

// Driver-initiated instant payout. Same FOR UPDATE lock-then-sweep-by-id
// discipline as runScheduledSettlementBatch — the fee row is inserted
// already 'cleared' inside this transaction so it's naturally included in
// the same locked-and-summed set, never a second uncoordinated write.
export async function instantCashOut(driverId: bigint): Promise<bigint> {
  const feeAmount = parseFloat(await getConfigValue('instant_payout_fee', '10'))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const bankRes = await client.query(
      `SELECT id FROM driver_bank_accounts
       WHERE driver_id = $1 AND is_primary = true AND status = 'verified'
       FOR UPDATE`,
      [driverId]
    )
    const bankAccount = bankRes.rows[0]
    if (!bankAccount) {
      throw httpError(400, 'No verified bank account on file', AppErrors.VALIDATION_ERROR.code)
    }

    const holdRes = await client.query(
      `SELECT 1 FROM driver_payout_holds WHERE driver_id = $1 AND active`,
      [driverId]
    )
    if (holdRes.rows.length > 0) {
      throw httpError(403, 'Payouts are on hold for this account', AppErrors.AUTH_FORBIDDEN.code)
    }

    await client.query(
      `INSERT INTO driver_earnings (
         driver_id, entry_type, amount, status, idempotency_key, note
       ) VALUES ($1,'adjustment',$2,'cleared',$3,'Instant cash-out fee')`,
      [driverId, -feeAmount, `instant_fee:${driverId}:${Date.now()}`]
    )

    // Lock and sum the driver's cleared rows (now including the fee row
    // just inserted above) — the same discipline as the scheduled batch
    // sweep: never SUM in one query and sweep via a separate re-evaluated
    // WHERE, always sweep the exact ids we locked and summed here.
    const lockedRes = await client.query(
      `SELECT id, amount FROM driver_earnings
       WHERE driver_id = $1 AND status = 'cleared'
       FOR UPDATE`,
      [driverId]
    )
    const rowIds = lockedRes.rows.map((r: { id: string }) => r.id)
    const total = lockedRes.rows.reduce((sum: number, r: { amount: string }) => sum + parseFloat(r.amount), 0)
    if (total <= 0) {
      throw httpError(400, 'No payable balance', AppErrors.VALIDATION_ERROR.code)
    }

    const now = new Date()
    const settlementRes = await client.query(
      `INSERT INTO settlements (
         driver_id, period_from, period_to, net_payout, fee, status, run_type, bank_account_id
       ) VALUES ($1,$2,$2,$3,$4,'processing','instant',$5)
       RETURNING id`,
      [driverId, now, total, feeAmount, bankAccount.id]
    )
    const settlementId = settlementRes.rows[0].id

    await client.query(
      `UPDATE driver_earnings
         SET status = 'in_payout', settlement_id = $2
       WHERE id = ANY($1::bigint[])`,
      [rowIds, settlementId]
    )

    await client.query('COMMIT')
    return BigInt(settlementId)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Submits every settlement row that's `processing` (approved, either
// auto-advanced under the auto-approve threshold or admin-approved) but not
// yet sent to the gateway (`razorpay_payout_id IS NULL`) to RazorpayX
// Payouts. Dev mode (no keys) marks them completed directly, mirroring the
// existing Razorpay dev-mode bypass elsewhere in this module — lets the
// whole pipeline be exercised without a gateway.
export async function submitProcessingSettlements(): Promise<void> {
  const pending = await pool.query(
    `SELECT id, driver_id, net_payout FROM settlements
     WHERE status = 'processing' AND razorpay_payout_id IS NULL`
  )
  if (pending.rows.length === 0) return

  const devMode = !config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET

  for (const row of pending.rows) {
    if (devMode) {
      await pool.query(
        `UPDATE settlements SET status = 'completed', completed_at = now(),
           razorpay_payout_id = $2, utr = $2
         WHERE id = $1`,
        [row.id, `dev_payout_${row.id}`]
      )
      await pool.query(
        `UPDATE driver_earnings SET status = 'paid' WHERE settlement_id = $1`,
        [row.id]
      )
      continue
    }

    try {
      // RazorpayX Payouts is a separate API surface on the same account —
      // reuses the same key pair already configured for collection.
      const Razorpay = (await import('razorpay')).default
      const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })
      const bankRes = await pool.query(
        `SELECT gateway_fund_account_id FROM driver_bank_accounts
         JOIN settlements s ON s.bank_account_id = driver_bank_accounts.id
         WHERE s.id = $1`,
        [row.id]
      )
      const fundAccountId = bankRes.rows[0]?.gateway_fund_account_id
      // RazorpayX Payouts isn't in this SDK version's TS types (only added via
      // addResources at runtime) — cast through unknown, same as elsewhere
      // this SDK's dynamic surface is used beyond its declared types.
      const rzpPayouts = (rzp as unknown as { payouts: { create: Function } }).payouts
      const payout = await (rzpPayouts.create as Function)({
        account_number: config.RAZORPAY_KEY_ID,
        fund_account_id: fundAccountId,
        amount: Math.round(parseFloat(row.net_payout) * 100),
        currency: 'INR',
        mode: 'IMPS',
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: `${row.id}:${row.driver_id}`,
      }) as { id: string }

      await pool.query(
        `UPDATE settlements SET razorpay_payout_id = $2 WHERE id = $1`,
        [row.id, payout.id]
      )
    } catch (err) {
      console.error(`[settlements] payout submit failed for settlement ${row.id}:`, err)
      await pool.query(
        `UPDATE settlements SET status = 'failed', failed_at = now(), failure_reason = $2 WHERE id = $1`,
        [row.id, err instanceof Error ? err.message : 'unknown error']
      )
      await pool.query(
        `UPDATE driver_earnings SET status = 'cleared', settlement_id = NULL WHERE settlement_id = $1`,
        [row.id]
      )
    }
  }
}

export interface DriverEarningsSummary {
  payableBalance: number
  recentLedger: Array<Record<string, unknown>>
}

export async function getDriverEarningsSummary(driverId: bigint): Promise<DriverEarningsSummary> {
  const balanceRes = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS payable_balance
     FROM driver_earnings WHERE driver_id = $1 AND status = 'cleared'`,
    [driverId]
  )
  const ledgerRes = await pool.query(
    `SELECT id, ride_id, entry_type, amount, status, created_at, note
     FROM driver_earnings WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [driverId]
  )
  return {
    payableBalance: parseFloat(balanceRes.rows[0].payable_balance),
    recentLedger: ledgerRes.rows,
  }
}
