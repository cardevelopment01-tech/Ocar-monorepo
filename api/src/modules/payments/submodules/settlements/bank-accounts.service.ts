import { pool } from '@/db/client'
import { config } from '@/config'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

export interface AddBankAccountInput {
  accountHolderName: string
  accountNumber: string
  ifsc: string
  upiVpa?: string
}

// AES-256-GCM so account numbers are never recoverable from a DB dump alone —
// must be decryptable (not hashed) so it can be sent to the payout gateway later.
function getEncryptionKey(): Buffer {
  const hex = config.BANK_ACCOUNT_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('BANK_ACCOUNT_ENCRYPTION_KEY must be a 32-byte (64 hex char) key')
  }
  return Buffer.from(hex, 'hex')
}

function encryptAccountNumber(accountNumber: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

// Not used yet — the RazorpayX disbursal flow (Task 8) will need to decrypt
// the account number to send to the payout gateway.
export function decryptAccountNumber(stored: string): string {
  const [ivHex, authTagHex, dataHex] = stored.split(':')
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivHex!, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex!, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex!, 'hex')), decipher.final()]).toString('utf8')
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

export async function setBankAccountStatus(
  bankAccountId: bigint, status: 'verified' | 'invalid' | 'pending_verification'
): Promise<void> {
  await pool.query(
    `UPDATE driver_bank_accounts SET status = $2 WHERE id = $1`,
    [bankAccountId, status]
  )
}

export async function listUnverifiedBankAccounts() {
  const res = await pool.query(
    `SELECT dba.id, dba.driver_id, d.full_name AS driver_name, dba.ifsc, dba.status, dba.created_at
     FROM driver_bank_accounts dba
     JOIN drivers d ON d.id = dba.driver_id
     WHERE dba.status IN ('pending_verification', 'invalid')
     ORDER BY dba.created_at`
  )
  return res.rows
}
