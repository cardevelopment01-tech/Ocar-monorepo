import { pool } from '@/db/client'
import { httpError } from '@/lib/errors'
import { getAdvancePolicy, POLICY_KEYS, type AdvancePolicy } from '@/lib/advance-policy'
import { updateConfigValue } from '@/lib/system-config'
import { recordAuditLog } from '@/lib/audit-log'

// Reading and changing the advance-booking policy from the Dispatch desk. The values are ordinary system_config rows (so the generic
// System Config page and its audit trail still see them); this adds typed validation and one save for the whole form.

type Changes = Partial<AdvancePolicy>

/** Turns the form's changes into config strings, refusing anything out of range. Exported for tests. */
export function validatePolicyChanges(input: unknown): Array<{ field: keyof AdvancePolicy; key: string; value: string }> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw httpError(422, 'changes must be an object', 'VALIDATION_ERROR')
  const out: Array<{ field: keyof AdvancePolicy; key: string; value: string }> = []
  for (const [field, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!(field in POLICY_KEYS)) throw httpError(422, `Unknown setting: ${field}`, 'VALIDATION_ERROR')
    const spec = POLICY_KEYS[field as keyof typeof POLICY_KEYS] as { key: string; min?: number; max?: number; integer?: boolean }
    if (field === 'lateCancelEnabled') {
      if (typeof raw !== 'boolean') throw httpError(422, 'lateCancelEnabled must be true or false', 'VALIDATION_ERROR')
      out.push({ field, key: spec.key, value: String(raw) })
    } else if (field === 'feeMode') {
      if (raw !== 'percent' && raw !== 'flat') throw httpError(422, 'feeMode must be percent or flat', 'VALIDATION_ERROR')
      out.push({ field, key: spec.key, value: raw })
    } else {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) throw httpError(422, `${field} must be a number`, 'VALIDATION_ERROR')
      if (spec.integer && !Number.isInteger(raw)) throw httpError(422, `${field} must be a whole number`, 'VALIDATION_ERROR')
      if (raw < (spec.min ?? 0) || raw > (spec.max ?? Number.MAX_SAFE_INTEGER)) throw httpError(422, `${field} must be between ${spec.min} and ${spec.max}`, 'VALIDATION_ERROR')
      out.push({ field: field as keyof AdvancePolicy, key: spec.key, value: String(raw) })
    }
  }
  return out
}

export async function readPolicy() {
  return { policy: await getAdvancePolicy(), limits: Object.fromEntries(Object.entries(POLICY_KEYS).map(([f, s]) => [f, { min: (s as { min?: number }).min ?? null, max: (s as { max?: number }).max ?? null }])) }
}

export async function savePolicy(changes: Changes, reason: string, adminId: bigint, ip: string | null) {
  const updates = validatePolicyChanges(changes)
  if (updates.length === 0) throw httpError(422, 'Nothing to change', 'VALIDATION_ERROR')
  const before = await getAdvancePolicy()
  for (const u of updates) {
    const row = await pool.query<{ id: string }>(`SELECT id::text FROM system_config WHERE key = $1 AND status = 'active'`, [u.key])
    const id = row.rows[0]?.id
    if (!id) throw httpError(409, `The setting ${u.key} is missing. Apply the latest database migration first.`, 'CONFIG_MISSING')
    const saved = await updateConfigValue(BigInt(id), u.value, adminId)
    if (!saved || saved === 'conflict') throw httpError(409, 'A setting changed while you were saving. Reload and try again.', 'CONFIG_CHANGED')
  }
  const after = await getAdvancePolicy()
  await recordAuditLog({
    adminId, action: 'advance_policy.update', targetTable: 'system_config', targetId: 0n,
    beforeState: { ...before }, afterState: { ...after }, ipAddress: ip, reason,
  })
  return after
}
