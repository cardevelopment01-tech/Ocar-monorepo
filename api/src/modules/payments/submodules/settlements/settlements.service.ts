import { pool } from '@/db/client'
import { getConfigValue } from '@/lib/system-config'

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

    const eligible = await client.query(
      `WITH cleared AS (
         SELECT driver_id, amount FROM driver_earnings WHERE status = 'cleared'
       )
       SELECT cleared.driver_id, dba.id AS bank_account_id, SUM(cleared.amount) AS total
       FROM cleared
       JOIN driver_bank_accounts dba
         ON dba.driver_id = cleared.driver_id AND dba.is_primary = true AND dba.status = 'verified'
       WHERE NOT EXISTS (
         SELECT 1 FROM driver_payout_holds h WHERE h.driver_id = cleared.driver_id AND h.active
       )
       GROUP BY cleared.driver_id, dba.id
       HAVING SUM(cleared.amount) > 0`
    )

    let batchTotal = 0
    for (const row of eligible.rows) batchTotal += parseFloat(row.total)
    const initialStatus = batchTotal <= autoApproveLimit ? 'processing' : 'pending'

    for (const row of eligible.rows) {
      const settlementRes = await client.query(
        `INSERT INTO settlements (
           driver_id, period_from, period_to, net_payout, status, run_type, bank_account_id
         ) VALUES ($1,$2,$3,$4,$5,'scheduled',$6)
         RETURNING id`,
        [row.driver_id, periodFrom, periodTo, row.total, initialStatus, row.bank_account_id]
      )
      const settlementId = settlementRes.rows[0].id

      await client.query(
        `UPDATE driver_earnings
           SET status = 'in_payout', settlement_id = $2
         WHERE driver_id = $1 AND status = 'cleared'`,
        [row.driver_id, settlementId]
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
