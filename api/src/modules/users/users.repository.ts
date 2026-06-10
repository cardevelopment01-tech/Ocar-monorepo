import { query } from '@/db/client'
import type { UserRecord } from '@/modules/auth/auth.types'

export interface UserProfile extends UserRecord {
  total_rides: number
  rating_avg: number | null
  wallet_balance: number
}

export async function findWithStats(id: bigint): Promise<UserProfile | null> {
  // total_rides, rating_avg, wallet_balance aggregated in M09/M11
  const rows = await query<UserRecord>(
    'SELECT * FROM users WHERE id = $1 LIMIT 1',
    [id.toString()]
  )
  if (!rows[0]) return null
  return { ...rows[0], total_rides: 0, rating_avg: null, wallet_balance: 0 }
}

export async function updateProfile(
  id: bigint,
  data: { name: string; email?: string }
): Promise<UserRecord> {
  const params: unknown[] = [data.name, id.toString()]
  let sql = 'UPDATE users SET name = $1, updated_at = now()'
  if (data.email !== undefined) {
    sql += ', email = $3'
    params.push(data.email)
  }
  sql += ' WHERE id = $2 RETURNING *'
  const rows = await query<UserRecord>(sql, params)
  return rows[0]!
}
