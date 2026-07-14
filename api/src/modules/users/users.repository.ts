import { query } from '@/db/client'
import type { UserRecord } from '@/modules/auth/auth.types'

export interface UserProfile extends UserRecord {
  total_rides: number
  rating_avg: number | null
  wallet_balance: number
}

export async function findWithStats(id: bigint): Promise<UserProfile | null> {
  const rows = await query<UserRecord & { rating_avg: string }>(
    'SELECT * FROM users WHERE id = $1 LIMIT 1',
    [id.toString()]
  )
  if (!rows[0]) return null

  const [rideRows, walletRows] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM rides WHERE user_id = $1 AND status = 'completed'`,
      [id.toString()]
    ),
    query<{ balance: string }>(
      'SELECT balance FROM user_wallets WHERE user_id = $1',
      [id.toString()]
    ),
  ])

  const ratingAvg = Number(rows[0].rating_avg)
  return {
    ...rows[0],
    total_rides:    Number(rideRows[0]?.count ?? 0),
    rating_avg:     ratingAvg > 0 ? ratingAvg : null,
    wallet_balance: Number(walletRows[0]?.balance ?? 0),
  }
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
