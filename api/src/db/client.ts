import { Pool, PoolClient, types } from 'pg'
import fs from 'fs'
import path from 'path'
import { Signer } from '@aws-sdk/rds-signer'
import { config } from '@/config'
import { logger } from '@/lib/logger'
import { getDbPassword } from '@/lib/db-secret'
import { pgQueryErrorsTotal } from '@/observability/metrics'

// IAM auth token is a local SigV4-signed string (no network call) and is only
// requested once per new physical connection, not per query — pg calls this
// function to obtain the "password" whenever it opens a fresh connection.
// Tokens are valid 15 minutes; requesting a fresh one per new connection avoids
// needing our own expiry/refresh-timer bookkeeping.
const iamSigner = config.DB_AUTH_MODE === 'iam'
  ? new Signer({ hostname: config.DB_HOST, port: config.DB_PORT, username: config.DB_USER, region: config.AWS_REGION })
  : null

// AWS's official RDS CA bundle (https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem),
// vendored rather than fetched at build/runtime for reproducible builds. Node's
// default trust store doesn't include Amazon's RDS CA, so without this,
// rejectUnauthorized: true fails every connection with SELF_SIGNED_CERT_IN_CHAIN
// (confirmed via a real deploy failure). Loaded lazily (only when an auth mode
// that needs it is active) so local dev / password mode never touches this file.
function loadRdsCaBundle(): Buffer {
  return fs.readFileSync(path.join(__dirname, 'certs/rds-global-bundle.pem'))
}

// pg's own connection-string parser (ConnectionParameters, in the `pg` package)
// does `config = Object.assign({}, config, parse(config.connectionString))` --
// the URL's own `sslmode` OVERWRITES any `ssl` object passed alongside
// `connectionString`, not the other way round. So an explicit `ssl` key next to
// `connectionString: url` is silently clobbered whenever the URL has a
// `sslmode` param. And `sslmode=require` alone (pg-connection-string, no
// `sslrootcert`) resolves to `{ rejectUnauthorized: false }` -- encrypted but
// unverified, same weaker posture the iam/secrets-manager modes above used to
// have before the RDS CA bundle fix. Password mode never got that fix. Only
// `sslmode` presence (never set for the plain local/CI Postgres in
// api/.env.example) triggers this branch, so local dev/CI is untouched.
// Hostname decides which trust anchor to verify against: an RDS host needs
// the vendored bundle (Node's default trust store doesn't include Amazon's
// self-signed RDS CA); anything else with sslmode=require (e.g. staging's
// Neon branch, see CLAUDE.md) already chains to a public CA already in
// Node's default trust store, so turning on verification needs no bundle at
// all there -- vendoring the RDS bundle for a Neon host would just fail
// verification against the wrong root.
function upgradedPasswordModeConfig(databaseUrl: string) {
  // `new URL('')`/`new URL(undefined)` throws -- this runs eagerly at module
  // load (`export const pool = new Pool({...buildPoolConfig()})`), so a
  // missing/empty DATABASE_URL must fall through unchanged rather than crash
  // the whole module on import. Real usage is already guarded (config's own
  // superRefine requires DATABASE_URL when DB_AUTH_MODE is 'password'); this
  // guard exists for test files that partially mock '@/config' without a
  // DATABASE_URL, which import client.ts for real (not mocked) and previously
  // got an inert `{ connectionString: undefined }` here, not a crash.
  if (!databaseUrl) {
    return { connectionString: databaseUrl }
  }
  const url = new URL(databaseUrl)
  if (!url.searchParams.has('sslmode')) {
    return { connectionString: databaseUrl }
  }
  url.searchParams.delete('sslmode')
  const isRds = url.hostname.endsWith('.rds.amazonaws.com')
  return {
    connectionString: url.toString(),
    ssl: isRds ? { ca: loadRdsCaBundle(), rejectUnauthorized: true } : { rejectUnauthorized: true },
  }
}

function buildPoolConfig() {
  if (config.DB_AUTH_MODE === 'iam' && iamSigner) {
    return {
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: () => iamSigner.getAuthToken(),
      ssl: { ca: loadRdsCaBundle(), rejectUnauthorized: true },
    }
  }
  if (config.DB_AUTH_MODE === 'secrets-manager') {
    return {
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: () => getDbPassword(config.DB_SECRET_ARN),
      ssl: { ca: loadRdsCaBundle(), rejectUnauthorized: true },
    }
  }
  return upgradedPasswordModeConfig(config.DATABASE_URL)
}

// DATE columns (oid 1082 — date_of_birth, valid_until, license_expiry, verified_for,
// etc.) have no time component, but pg's default parser builds a JS Date at LOCAL
// midnight. Any later .toISOString()/JSON.stringify (which is always UTC) then shifts
// the date backward a day on any host with a positive UTC offset (e.g. Asia/Calcutta).
// Keep the 'YYYY-MM-DD' string Postgres already returns instead of round-tripping
// through a timezone-ambiguous Date object.
types.setTypeParser(1082, (val) => val)

export const pool = new Pool({
  ...buildPoolConfig(),
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
  ...buildPoolConfig(),
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
      logger.warn({ durationMs: duration, query: text }, 'slow query')
    }
    return result.rows
  } catch (err) {
    const error = err as Error & { code?: string }
    if (error.code) pgQueryErrorsTotal.inc({ code: error.code })
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
