import { Pool, PoolClient } from 'pg'
import { config } from '@/config'

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  min: config.DATABASE_POOL_MIN,
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

export async function query<T extends object>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const start = Date.now()
  try {
    const result = await pool.query<T>(text, params)
    const duration = Date.now() - start
    if (duration > 1000) {
      console.warn(`Slow query (${duration}ms): ${text}`)
    }
    return result.rows
  } catch (err) {
    const error = err as Error
    error.message = `${error.message} — query: ${text}`
    throw error
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DB connection timeout')), 3000)
      ),
    ])
    return true
  } catch {
    return false
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
