import { Pool, PoolClient, types } from 'pg'
import { config } from '@/config'

// DATE columns (oid 1082 — date_of_birth, valid_until, license_expiry, verified_for,
// etc.) have no time component, but pg's default parser builds a JS Date at LOCAL
// midnight. Any later .toISOString()/JSON.stringify (which is always UTC) then shifts
// the date backward a day on any host with a positive UTC offset (e.g. Asia/Calcutta).
// Keep the 'YYYY-MM-DD' string Postgres already returns instead of round-tripping
// through a timezone-ambiguous Date object.
types.setTypeParser(1082, (val) => val)

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  min: config.DATABASE_POOL_MIN,
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Bounds a runaway/blocking query so it can't hold a connection (and any
  // locks it took) forever and starve the rest of the pool.
  statement_timeout: 10000,
  // Bound a stalled mid-transaction client so it can't hold locks + a connection forever.
  idle_in_transaction_session_timeout: 15000,
})

// Dedicated pool for high-rate direct-query BullMQ workers (gps-flush, notifications)
// so their insert/select bursts don't compete with HTTP request handlers for `pool`.
// ponytail: only DIRECT-query workers use this. The dispatch worker routes through
// repository functions that import the shared request `pool`, so it still shares the
// request pool as a documented ceiling — revisit (thread an executor through the repos)
// only if a load test proves request-pool starvation from dispatch.
export const workerPool = new Pool({
  connectionString: config.DATABASE_URL,
  min: 1,
  max: config.WORKER_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  idle_in_transaction_session_timeout: 15000,
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
