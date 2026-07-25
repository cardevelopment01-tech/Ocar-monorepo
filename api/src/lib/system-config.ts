import { pool } from '@/db/client'

export async function getConfigValue(key: string, fallback: string): Promise<string> {
  const res = await pool.query(
    `SELECT value FROM system_config WHERE key = $1 AND status = 'active'`,
    [key]
  )
  return res.rows[0]?.value ?? fallback
}
