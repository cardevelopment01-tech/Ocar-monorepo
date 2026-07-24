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
