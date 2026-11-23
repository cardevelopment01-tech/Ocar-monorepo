import path from 'path'

// Load .env before any module imports config — Node 22 built-in, no dotenv needed
try {
  process.loadEnvFile(path.resolve(__dirname, '../.env'))
} catch {
  // .env absent in CI — env vars must be set externally
}

process.env['NODE_ENV'] = 'test'
// Tests never call the breach-check service; the password-policy tests inject their own fetch.
process.env['PASSWORD_BREACH_CHECK'] = 'off'

if (process.env['TEST_DATABASE_URL']) {
  process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']
}
