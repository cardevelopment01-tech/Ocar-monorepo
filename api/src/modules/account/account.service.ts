import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { httpError } from '@/lib/errors'
import { recordAuditLog } from '@/lib/audit-log'

export type AccountRole = 'user' | 'driver'

// Erases a rider's or driver's personal data and closes the account (Google Play account-deletion policy).
// The row itself stays: rides, payments, ledgers and settlements reference it and are kept for the
// financial and safety retention our privacy policy states. What goes: name, email, phone (replaced by a
// placeholder, which also frees the number for a fresh sign-up), identity numbers, address, emergency
// contact, bank details, saved places, push tokens, notification history, and every session.
// Driver verification documents (files and rows) are kept for the regulatory period the privacy policy
// describes; they are not touched here.
export async function deleteAccount(role: AccountRole, id: bigint, ip: string | null): Promise<void> {
  const table = role === 'user' ? 'users' : 'drivers'
  const rideColumn = role === 'user' ? 'user_id' : 'driver_id'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const row = await client.query<{ status: string }>(`SELECT status FROM ${table} WHERE id = $1 FOR UPDATE`, [id.toString()])
    if (row.rows.length === 0 || row.rows[0]!.status === 'deleted') {
      await client.query('ROLLBACK')
      return // already gone: deleting twice is not an error
    }

    const live = await client.query(
      `SELECT 1 FROM rides WHERE ${rideColumn} = $1 AND status IN ('requested', 'accepted', 'driver_arrived', 'in_progress', 'returning') LIMIT 1`,
      [id.toString()],
    )
    if (live.rows.length > 0) throw httpError(409, 'Finish or cancel your current ride first', 'ACCOUNT_HAS_ACTIVE_RIDE')

    const wallet = await client.query<{ balance: string }>(
      `SELECT balance FROM ${role === 'user' ? 'user_wallets' : 'driver_wallets'} WHERE ${role === 'user' ? 'user_id' : 'driver_id'} = $1`,
      [id.toString()],
    )
    if (wallet.rows.length > 0 && Number(wallet.rows[0]!.balance) > 0) {
      throw httpError(409, 'Your wallet still has a balance. Contact support to withdraw it before deleting your account', 'ACCOUNT_HAS_BALANCE')
    }
    if (role === 'driver') {
      const pending = await client.query(`SELECT 1 FROM settlements WHERE driver_id = $1 AND status IN ('pending', 'processing', 'on_hold') LIMIT 1`, [id.toString()])
      if (pending.rows.length > 0) throw httpError(409, 'A payout is still being processed. Try again once it completes', 'ACCOUNT_HAS_PENDING_PAYOUT')
    }

    if (role === 'user') {
      await client.query(
        `UPDATE users SET status = 'deleted', phone = 'deleted:' || id, name = NULL, email = NULL, fcm_token = NULL, updated_at = now() WHERE id = $1`,
        [id.toString()],
      )
      await client.query('DELETE FROM saved_places WHERE user_id = $1', [id.toString()])
    } else {
      await client.query(
        `UPDATE drivers SET status = 'deleted', phone = 'deleted:' || id, full_name = NULL, email = NULL, gender = NULL,
                date_of_birth = NULL, residential_address = NULL, state = NULL, city = NULL, pincode = NULL,
                experience_years = NULL, emergency_contact = NULL, languages_known = '{}', aadhaar_number = NULL,
                license_number = NULL, fcm_token = NULL, updated_at = now() WHERE id = $1`,
        [id.toString()],
      )
      await client.query(
        `UPDATE driver_bank_accounts SET account_holder_name = 'deleted', account_number_enc = 'deleted', ifsc = 'DELETED0000',
                upi_vpa = NULL, gateway_fund_account_id = NULL WHERE driver_id = $1`,
        [id.toString()],
      )
      await client.query(`UPDATE driver_sessions SET status = 'offline', went_offline_at = now() WHERE driver_id = $1 AND status <> 'offline'`, [id.toString()])
      await client.query('DELETE FROM driver_location_snapshots WHERE driver_id = $1', [id.toString()])
    }

    await client.query('DELETE FROM device_tokens WHERE owner_type = $1 AND owner_id = $2', [role, id.toString()])
    await client.query(`DELETE FROM notification_logs WHERE owner_type = $1 AND owner_id = $2`, [role, id.toString()])
    await client.query('DELETE FROM notification_preferences WHERE owner_type = $1 AND owner_id = $2', [role, id.toString()])
    await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE principal_role = $1 AND principal_id = $2 AND revoked_at IS NULL`, [role, id.toString()])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }

  // The auth middleware caches the principal's status; drop it so the deletion takes effect now.
  await redis.del(`auth:${role}:${id}`).catch(() => undefined)
  await recordAuditLog({ adminId: null, action: 'account_deleted', targetTable: table, targetId: id, ipAddress: ip }).catch(() => undefined)
}
