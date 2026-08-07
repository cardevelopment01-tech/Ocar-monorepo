import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

const isFresh = process.argv.includes('--fresh')
// Migrations need a direct (non-pooled) connection — pg_advisory_lock is
// session-scoped, and Neon's pooler runs in transaction mode, which doesn't
// guarantee lock/unlock land on the same physical backend. Over the pooler
// that can orphan the lock forever, hanging every future migration run.
// MIGRATION_DATABASE_URL is optional: unset in local dev/CI, where DATABASE_URL
// already points at a plain, unpooled Postgres with no pooler in the mix.
const databaseUrl = process.env['MIGRATION_DATABASE_URL'] || process.env['DATABASE_URL']

if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is not set')
  process.exit(1)
}

const pool = new Pool({ connectionString: databaseUrl })

// Arbitrary fixed key — any two migrate.ts processes contend for the same
// session-level lock, so only one can run migrations at a time. Prevents the
// "CREATE TABLE IF NOT EXISTS" race that happens when two API containers
// briefly overlap during a deploy (both start, both see a migration as
// not-yet-applied, both try to create the same table at once).
const MIGRATION_LOCK_KEY = 8927341

async function migrate(): Promise<void> {
  const client = await pool.connect()
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])

  try {
    if (isFresh) {
      if (process.env['NODE_ENV'] === 'production') {
        console.error('ERROR: --fresh cannot be used in production')
        process.exit(1)
      }
      console.log('Dropping all tables (--fresh mode)...')
      // Drop extensions (which own their tables like spatial_ref_sys), then recreate
      await client.query(`DROP EXTENSION IF EXISTS postgis CASCADE`)
      await client.query(`DROP EXTENSION IF EXISTS citext CASCADE`)
      // Drop any remaining user tables
      await client.query(`
        DO $$ DECLARE
          r RECORD;
        BEGIN
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP;
        END $$;
      `)
      // Drop all enums
      await client.query(`
        DO $$ DECLARE
          r RECORD;
        BEGIN
          FOR r IN (SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace) LOOP
            EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
          END LOOP;
        END $$;
      `)
      // Drop all sequences
      await client.query(`
        DO $$ DECLARE
          r RECORD;
        BEGIN
          FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
            EXECUTE 'DROP SEQUENCE IF EXISTS ' || quote_ident(r.sequence_name) || ' CASCADE';
          END LOOP;
        END $$;
      `)
      console.log('All tables, enums, and sequences dropped.')
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        ran_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    const migrationsDir = path.join(__dirname, 'migrations')
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const filename of files) {
      const row = await client.query(
        'SELECT filename FROM schema_migrations WHERE filename = $1',
        [filename]
      )

      if ((row.rowCount ?? 0) > 0) {
        console.log(`skipped: ${filename}`)
        continue
      }

      const filePath = path.join(migrationsDir, filename)
      const sql = fs.readFileSync(filePath, 'utf-8')

      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        )
        await client.query('COMMIT')
        console.log(`ran: ${filename}`)
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`ERROR in ${filename}:`, err)
        process.exit(1)
      }
    }

    console.log('Migration complete.')
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    client.release()
    await pool.end()
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
