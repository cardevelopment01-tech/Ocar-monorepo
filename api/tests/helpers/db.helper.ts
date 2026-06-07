import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL']
    if (!url) throw new Error('TEST_DATABASE_URL is not set')
    pool = new Pool({ connectionString: url })
  }
  return pool
}

export async function setupTestDb(): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        ran_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    const migrationsDir = path.join(__dirname, '../../src/db/migrations')
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const filename of files) {
      const row = await client.query(
        'SELECT filename FROM schema_migrations WHERE filename = $1',
        [filename]
      )
      if ((row.rowCount ?? 0) > 0) continue

      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf-8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        )
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    client.release()
  }
}

export async function teardownTestDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export async function clearAllTables(): Promise<void> {
  const client = await getPool().connect()
  try {
    const result = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'schema_migrations'`
    )
    if (result.rows.length > 0) {
      const tables = result.rows.map((r) => `"${r.tablename}"`).join(', ')
      await client.query(`TRUNCATE ${tables} CASCADE`)
    }
  } finally {
    client.release()
  }
}
