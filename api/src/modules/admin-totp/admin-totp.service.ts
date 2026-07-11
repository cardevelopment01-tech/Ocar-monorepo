import crypto from 'crypto'
import QRCode from 'qrcode'
import { generateSecret, generateURI, verify } from 'otplib'
import { AppErrors } from '@/constants/errors'
import { createHttpError } from '@/lib/errors'
import { encryptTotpSecret, decryptTotpSecret } from '@/lib/totp-crypto'
import { hashPassword, comparePassword } from '@/lib/hash'
import { recordAuditLog } from '@/lib/audit-log'
import * as repo from './admin-totp.repository'

const RECOVERY_CODE_COUNT = 8
// Excludes ambiguous characters (0/O, 1/I) so codes are easy to transcribe by hand.
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
// otplib's epochTolerance is in seconds; 30s = ±1 time step of clock drift.
const EPOCH_TOLERANCE_SECONDS = 30

export function generateRecoveryCode(): string {
  const bytes = crypto.randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += RECOVERY_CODE_ALPHABET[bytes[i]! % RECOVERY_CODE_ALPHABET.length]
    if (i === 3) code += '-'
  }
  return code
}

export async function getStatus(adminId: bigint): Promise<{ totpEnabled: boolean; mandatory: boolean }> {
  const state = await repo.getAdminTotpState(adminId)
  if (!state) throw createHttpError(AppErrors.NOT_FOUND)
  return {
    totpEnabled: state.totp_enabled,
    mandatory: state.role === 'super_admin' || state.role === 'finance_admin',
  }
}

export async function startSetup(adminId: bigint): Promise<{ secret: string; qrDataUrl: string }> {
  const state = await repo.getAdminTotpState(adminId)
  if (!state) throw createHttpError(AppErrors.NOT_FOUND)

  const secret = generateSecret()
  await repo.setPendingSecret(adminId, encryptTotpSecret(secret))

  const uri = generateURI({ issuer: 'Ocar Admin', label: state.email, secret })
  const qrDataUrl = await QRCode.toDataURL(uri)

  return { secret, qrDataUrl }
}

export async function confirmSetup(adminId: bigint, code: string, ipAddress: string | null): Promise<{ recoveryCodes: string[] }> {
  const state = await repo.getAdminTotpState(adminId)
  if (!state?.totp_secret_enc) throw createHttpError(AppErrors.TOTP_NO_PENDING_SETUP)

  const secret = decryptTotpSecret(state.totp_secret_enc)
  const result = await verify({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS })
  if (!result.valid) throw createHttpError(AppErrors.TOTP_INVALID_CODE)

  await repo.enableTotp(adminId)
  // Guards the very first login-verify against replaying this same setup code.
  await repo.recordUsedTimeStep(adminId, (result as { timeStep: number }).timeStep)

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)
  const hashed = await Promise.all(recoveryCodes.map(hashPassword))
  await repo.replaceRecoveryCodes(adminId, hashed)

  await recordAuditLog({
    adminId,
    action: 'admin_totp.enabled',
    targetTable: 'admins',
    targetId: adminId,
    ipAddress,
  })

  return { recoveryCodes }
}

export async function disableTotp(adminId: bigint, password: string, ipAddress: string | null): Promise<void> {
  const state = await repo.getAdminTotpState(adminId)
  if (!state) throw createHttpError(AppErrors.NOT_FOUND)

  const valid = await comparePassword(password, state.password_hash)
  if (!valid) throw createHttpError(AppErrors.AUTH_UNAUTHORIZED)

  await repo.disableTotp(adminId)

  await recordAuditLog({
    adminId,
    action: 'admin_totp.disabled',
    targetTable: 'admins',
    targetId: adminId,
    ipAddress,
  })
}

// Used by the login-verify step. Tries a TOTP code first, then falls back to
// unused recovery codes (consuming one on match). Returns false rather than
// throwing — the caller decides how to surface "invalid" vs "expired session".
export async function verifyLoginCode(adminId: bigint, code: string): Promise<boolean> {
  const state = await repo.getAdminTotpState(adminId)
  if (!state?.totp_enabled || !state.totp_secret_enc) return false

  // otplib's verify() throws for a token that isn't 6 digits (e.g. a
  // recovery code) instead of returning invalid — only call it on input
  // shaped like a real TOTP code, so recovery codes fall straight through.
  if (/^\d{6}$/.test(code)) {
    const secret = decryptTotpSecret(state.totp_secret_enc)
    // exactOptionalPropertyTypes: build options first, then conditionally add afterTimeStep.
    const verifyOptions: Parameters<typeof verify>[0] = { secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS }
    if (state.totp_last_timestep !== null) verifyOptions.afterTimeStep = Number(state.totp_last_timestep)

    const result = await verify(verifyOptions)
    if (result.valid) {
      // RFC 6238 replay guard — this exact time step (or an earlier one)
      // can never be accepted again, closing the window for a captured
      // code to be replayed before it naturally expires.
      await repo.recordUsedTimeStep(adminId, (result as { timeStep: number }).timeStep)
      return true
    }
  }

  const unused = await repo.findUnusedRecoveryCodes(adminId)
  for (const row of unused) {
    if (await comparePassword(code, row.code_hash)) {
      await repo.markRecoveryCodeUsed(row.id)
      return true
    }
  }

  return false
}
