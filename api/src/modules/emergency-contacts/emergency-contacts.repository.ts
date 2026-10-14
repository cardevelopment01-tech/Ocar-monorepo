import { query, withTransaction } from '@/db/client'

export interface EmergencyContactDTO {
  id: string
  name: string
  phone: string
}

const COLUMNS = 'id, name, phone'

export const list = (userId: bigint) =>
  query<EmergencyContactDTO>(
    `SELECT ${COLUMNS} FROM user_emergency_contacts WHERE user_id = $1 ORDER BY created_at`,
    [userId.toString()]
  )

export async function insert(userId: bigint, name: string, phone: string): Promise<EmergencyContactDTO> {
  const rows = await query<EmergencyContactDTO>(
    `INSERT INTO user_emergency_contacts (user_id, name, phone) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
    [userId.toString(), name, phone]
  )
  return rows[0]!
}

export type InsertWithinLimitResult =
  | { result: 'added'; contact: EmergencyContactDTO }
  | { result: 'limit' | 'duplicate' | 'own_number' }

// Contacts are capped per user. Reading the list, checking its length and then inserting lets simultaneous adds all
// pass the check (three at once bypassed the limit of 3). A per-user advisory lock, held to the end of the
// transaction, makes the count and the insert one atomic step per user. 7301 is just this table's lock namespace.
const LOCK_NAMESPACE = 7301

export function insertWithinLimit(userId: bigint, name: string, phone: string, max: number): Promise<InsertWithinLimitResult> {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCK_NAMESPACE, Number(userId % 2147483647n)])
    const existing = await client.query<{ phone: string }>('SELECT phone FROM user_emergency_contacts WHERE user_id = $1', [userId.toString()])
    if (existing.rows.length >= max) return { result: 'limit' as const }
    if (existing.rows.some((c) => c.phone === phone)) return { result: 'duplicate' as const }
    const own = await client.query<{ phone: string }>('SELECT phone FROM users WHERE id = $1', [userId.toString()])
    if (own.rows[0]?.phone === phone) return { result: 'own_number' as const }
    const ins = await client.query<EmergencyContactDTO>(
      `INSERT INTO user_emergency_contacts (user_id, name, phone) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [userId.toString(), name, phone]
    )
    return { result: 'added' as const, contact: ins.rows[0]! }
  })
}

export async function remove(userId: bigint, id: bigint): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'DELETE FROM user_emergency_contacts WHERE id = $1 AND user_id = $2 RETURNING id',
    [id.toString(), userId.toString()]
  )
  return rows.length > 0
}
