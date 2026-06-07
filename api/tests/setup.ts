import path from 'path'

// Load .env before any module imports config — Node 22 built-in, no dotenv needed
try {
  process.loadEnvFile(path.resolve(__dirname, '../.env'))
} catch {
  // .env absent in CI — env vars must be set externally
}

process.env['NODE_ENV'] = 'test'

if (process.env['TEST_DATABASE_URL']) {
  process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']
}
