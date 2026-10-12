import { query } from '@/db/client'

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

export async function remove(userId: bigint, id: bigint): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'DELETE FROM user_emergency_contacts WHERE id = $1 AND user_id = $2 RETURNING id',
    [id.toString(), userId.toString()]
  )
  return rows.length > 0
}
