import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

// Reads the RDS master password directly from Secrets Manager instead of a
// hand-copied SSM parameter, so there's never a stale copy to drift out of
// sync with a rotation (see docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md).
// Cached briefly since this is called once per new pg connection, not per
// query — avoids hammering the API on connection-heavy bursts. Serves the
// last-known-good value on a transient fetch error rather than failing a new
// connection outright.
// Reads AWS_REGION directly from process.env, not the app's Zod config module
// — this file is also imported by migrate.ts, which deliberately stays
// standalone (reads only the env vars it needs) rather than requiring every
// prod env var the full config schema demands just to run a migration.
const CACHE_TTL_MS = 5 * 60 * 1000
const client = new SecretsManagerClient({ region: process.env['AWS_REGION'] || 'ap-south-1' })
let cached: { password: string; fetchedAt: number } | null = null

export async function getDbPassword(secretArn: string): Promise<string> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.password

  try {
    const res = await client.send(new GetSecretValueCommand({ SecretId: secretArn }))
    const { password } = JSON.parse(res.SecretString ?? '{}') as { password?: string }
    if (!password) throw new Error('Secret has no password field')
    cached = { password, fetchedAt: Date.now() }
    return password
  } catch (err) {
    if (cached) return cached.password
    throw err
  }
}
