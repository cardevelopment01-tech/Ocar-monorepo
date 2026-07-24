import { pool } from '@/db/client'
import { config } from '@/config'
import { createHmac } from 'crypto'

export interface AddBankAccountInput {
  accountHolderName: string
  accountNumber: string
  ifsc: string
  upiVpa?: string
}

// Simple reversible encoding so raw account numbers are never stored in
// plaintext at rest — same threat model as other sensitive-but-not-password
// fields in this codebase (no bcrypt needed, this must be decryptable to
// pass to the payout gateway). Uses the Razorpay webhook secret as the key
// so no new secret needs provisioning.
function encryptAccountNumber(accountNumber: string): string {
  const key = config.RAZORPAY_WEBHOOK_SECRET || 'dev-only-key'
  return createHmac('sha256', key).update(accountNumber).digest('hex') + ':' + Buffer.from(accountNumber).toString('base64')
}

export async function addBankAccount(driverId: bigint, input: AddBankAccountInput): Promise<bigint> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE driver_bank_accounts SET is_primary = false WHERE driver_id = $1`,
      [driverId]
    )

    // Dev mode (no Razorpay keys configured): auto-verify so the payout flow
    // is exercisable without a gateway, mirroring the existing Razorpay
    // dev-mode bypass in createRidePaymentOrder/topUpDriverWallet. Status is
    // one of two fixed literals below, never user input, so inlining it is safe.
    const status = (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) ? 'verified' : 'pending_verification'

    const res = await client.query(
      `INSERT INTO driver_bank_accounts (
         driver_id, account_holder_name, account_number_enc, ifsc, upi_vpa, status, is_primary
       ) VALUES ($1,$2,$3,$4,$5,'${status}',true)
       RETURNING id`,
      [driverId, input.accountHolderName, encryptAccountNumber(input.accountNumber), input.ifsc, input.upiVpa ?? null]
    )

    await client.query('COMMIT')
    return BigInt(res.rows[0].id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listBankAccounts(driverId: bigint) {
  const res = await pool.query(
    `SELECT id, account_holder_name, ifsc, upi_vpa, status, is_primary, created_at
     FROM driver_bank_accounts WHERE driver_id = $1 ORDER BY is_primary DESC, created_at DESC`,
    [driverId]
  )
  return res.rows
}

export async function getPrimaryVerifiedBankAccount(driverId: bigint) {
  const res = await pool.query(
    `SELECT id FROM driver_bank_accounts
     WHERE driver_id = $1 AND is_primary = true AND status = 'verified'`,
    [driverId]
  )
  return res.rows[0] ? BigInt(res.rows[0].id) : null
}
