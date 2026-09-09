// load-tests/seed/lib/staging-db.js
//
// Derives a live connection config for staging's RDS instance directly from
// AWS (describe-db-instances + Secrets Manager), instead of reading
// DATABASE_URL from a hand-maintained SSM parameter -- same principle as
// user_data.sh.tpl's own DB_HOST/DB_SECRET_ARN derivation and deploy.yml's
// migration step (docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md). This
// closes the exact gap that caused a whole session of confusion: staging's
// DATABASE_URL SSM value still pointed at the pre-migration Neon database,
// so every seed script silently wrote to Neon while the app itself (once
// DB_AUTH_MODE=secrets-manager) read from RDS. Hardcoded to staging only --
// this tooling must never be pointed at prod.
//
// Requires AWS CLI credentials in the environment (same ones used
// throughout this repo's ops workflows) -- shells out rather than adding
// an AWS SDK dependency, since the CLI is already a required tool here.

const { execSync } = require('child_process')

const DB_INSTANCE_IDENTIFIER = 'ocar-staging-db'
const DB_NAME = 'ocar'
const DB_USER = 'ocar_admin'
const AWS_REGION = 'ap-south-1'

function awsJson(cmd) {
  return JSON.parse(execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }))
}
function awsText(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim()
}

function getStagingDbConfig() {
  const info = awsJson(
    `aws rds describe-db-instances --region ${AWS_REGION} --db-instance-identifier ${DB_INSTANCE_IDENTIFIER} ` +
    `--query "DBInstances[0].{Host:Endpoint.Address,Port:Endpoint.Port,SecretArn:MasterUserSecret.SecretArn}" --output json`
  )
  if (!info || !info.SecretArn) {
    throw new Error(`Could not resolve ${DB_INSTANCE_IDENTIFIER}'s master secret -- is it running and does manage_master_user_password apply?`)
  }
  const secretJson = awsText(
    `aws secretsmanager get-secret-value --region ${AWS_REGION} --secret-id "${info.SecretArn}" --query SecretString --output text`
  )
  const { password } = JSON.parse(secretJson)

  return {
    // RDS is private (no CIDR ingress to it from outside the VPC, by
    // design -- see infra/terraform/security-groups.tf). Local runs of this
    // tooling need an SSM port-forward tunnel through a staging EC2 instance
    // first; these two overrides let the tunnel's local host/port stand in
    // for the real (VPC-internal) endpoint without touching this file.
    host: process.env.STAGING_DB_HOST || info.Host,
    port: process.env.STAGING_DB_PORT ? Number(process.env.STAGING_DB_PORT) : info.Port,
    database: DB_NAME,
    user: DB_USER,
    password,
    // Local/ops tooling, not the shipped app -- skipping the bundled RDS CA
    // (api/src/db/certs/rds-global-bundle.pem) is an acceptable simplification
    // here; connection is still encrypted, just not chain-verified.
    ssl: { rejectUnauthorized: false },
  }
}

module.exports = { getStagingDbConfig, DB_INSTANCE_IDENTIFIER }
