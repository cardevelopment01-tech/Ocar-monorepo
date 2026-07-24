import { pool } from '@/db/client'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { encryptAccountNumber } from './bank-accounts.service'

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/

// Driver self-declares a PAN, same self-declare-then-admin-verify pattern as
// addBankAccount/setBankAccountStatus. Resubmitting resets pan_verified —
// an admin must re-confirm any new PAN value before the 1% (vs 20%) TDS rate
// applies again (see accrueDriverEarning).
export async function submitDriverPan(driverId: bigint, pan: string): Promise<void> {
  const normalized = pan.trim().toUpperCase()
  if (!PAN_REGEX.test(normalized)) {
    throw httpError(422, 'PAN is invalid', AppErrors.VALIDATION_ERROR.code)
  }

  await pool.query(
    `INSERT INTO driver_tax_profile (driver_id, pan_enc, pan_verified)
     VALUES ($1,$2,false)
     ON CONFLICT (driver_id) DO UPDATE SET pan_enc = $2, pan_verified = false`,
    [driverId, encryptAccountNumber(normalized)]
  )
}

export async function verifyDriverPan(driverId: bigint, verified: boolean): Promise<boolean> {
  const res = await pool.query(
    `UPDATE driver_tax_profile SET pan_verified = $2 WHERE driver_id = $1`,
    [driverId, verified]
  )
  return (res.rowCount ?? 0) > 0
}
