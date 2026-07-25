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

// Exported (not just accountNumber-specific in practice — AES-256-GCM over any
// string) so tax-profile.service.ts can reuse it for PAN encryption instead of
// duplicating the same crypto logic.
export function encryptAccountNumber(accountNumber: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

// Used by createRazorpayXFundAccount below to send the real account number
// to the payout gateway when a bank account is marked verified.
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

// RazorpayX Payouts needs a fund_account_id to pay out to, which itself needs
// a contact_id first — neither has a resource in the installed `razorpay` SDK
// (v2.9.6 only ships the older Customer Fund Account API, keyed off
// customer_id, not the RazorpayX contact/fund-account pair), so this calls
// the REST API directly, same pattern as submitSettlementRow's payout call.
// Returns null on success (fund account created / dev placeholder set), or an
// error message on failure — caller must not mark the account verified if
// this fails, or admin gets a verified-but-non-functional payout target.
async function createRazorpayXFundAccount(
  bankAccountId: bigint, driverId: bigint, accountHolderName: string, ifsc: string, accountNumberEnc: string
): Promise<string | null> {
  const authHeader = 'Basic ' + Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64')

  try {
    const contactRes = await fetch('https://api.razorpay.com/v1/contacts', {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: accountHolderName,
        type: 'employee',
        reference_id: driverId.toString(),
      }),
    })
    if (!contactRes.ok) {
      return `RazorpayX contact creation failed (${contactRes.status}): ${await contactRes.text()}`
    }
    const contact = await contactRes.json() as { id: string }

    const fundAccountRes = await fetch('https://api.razorpay.com/v1/fund_accounts', {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: contact.id,
        account_type: 'bank_account',
        bank_account: {
          name: accountHolderName,
          ifsc,
          account_number: decryptAccountNumber(accountNumberEnc),
        },
      }),
    })
    if (!fundAccountRes.ok) {
      return `RazorpayX fund account creation failed (${fundAccountRes.status}): ${await fundAccountRes.text()}`
    }
    const fundAccount = await fundAccountRes.json() as { id: string }

    await pool.query(
      `UPDATE driver_bank_accounts SET gateway_fund_account_id = $2 WHERE id = $1`,
      [bankAccountId, fundAccount.id]
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'unknown error'
  }
}

// Verifying is the natural gate for creating the gateway fund account — a
// bank account shouldn't be payout-usable before it's verified anyway. On
// failure the status update does NOT happen, so the admin sees the failure
// instead of silently getting a verified-but-non-functional account.
export async function setBankAccountStatus(
  bankAccountId: bigint, status: 'verified' | 'invalid' | 'pending_verification'
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (status === 'verified') {
    const devMode = !config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET
    if (devMode) {
      await pool.query(
        `UPDATE driver_bank_accounts SET gateway_fund_account_id = $2 WHERE id = $1`,
        [bankAccountId, `dev_fund_account_${bankAccountId}`]
      )
    } else {
      const acctRes = await pool.query(
        `SELECT driver_id, account_holder_name, ifsc, account_number_enc
         FROM driver_bank_accounts WHERE id = $1`,
        [bankAccountId]
      )
      const acct = acctRes.rows[0]
      if (!acct) return { ok: false, error: 'Bank account not found' }

      const error = await createRazorpayXFundAccount(
        bankAccountId, BigInt(acct.driver_id), acct.account_holder_name, acct.ifsc, acct.account_number_enc
      )
      if (error) return { ok: false, error }
    }
  }

  await pool.query(
    `UPDATE driver_bank_accounts SET status = $2 WHERE id = $1`,
    [bankAccountId, status]
  )
  return { ok: true }
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
