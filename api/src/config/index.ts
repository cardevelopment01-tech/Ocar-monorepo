import { z, ZodError } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  // 'password' (default): connect via DATABASE_URL, as today. 'iam': connect via
  // a short-lived signed token (@aws-sdk/rds-signer) using DB_HOST/PORT/NAME/USER
  // below instead of a stored password — see infra/terraform/rds.tf's
  // iam_database_authentication_enabled comment for why. 'secrets-manager': read
  // the RDS master password directly from Secrets Manager (DB_SECRET_ARN) instead
  // of copying it into a static env var — see
  // docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md for why 'iam' isn't safe for
  // the master user. Local dev / Docker Postgres supports none of these, so this
  // stays 'password' there.
  DB_AUTH_MODE: z.enum(['password', 'iam', 'secrets-manager']).default('password'),
  DATABASE_URL: z.string().default(''),
  DB_HOST: z.string().default(''),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default(''),
  DB_USER: z.string().default(''),
  DB_SECRET_ARN: z.string().default(''),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  // Request-handler pool. The high-rate workers (gps-flush @ concurrency 20, etc.)
  // now run on their own workerPool (WORKER_POOL_MAX below), so this no longer has to
  // absorb their connections. Kept at request max 15 + worker max 10 = 25 conns/instance,
  // which fits under Neon Launch's pooler ceiling.
  DATABASE_POOL_MAX: z.coerce.number().default(15),
  // Dedicated pool for direct-query BullMQ workers (gps-flush, notifications) so their
  // insert/select bursts don't starve HTTP request handlers of the request pool.
  WORKER_POOL_MAX: z.coerce.number().default(10),

  // Redis
  REDIS_URL: z.string().min(1),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRY: z.string().regex(/^\d+[smhd]$/).default('15m'),
  JWT_REFRESH_EXPIRY_USER: z.string().regex(/^\d+[smhd]$/).default('30d'),
  JWT_REFRESH_EXPIRY_ADMIN: z.string().regex(/^\d+[smhd]$/).default('24h'),

  // TOTP (admin 2FA) — 32-byte key, hex-encoded (64 hex chars), for AES-256-GCM
  TOTP_ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-f]+$/i),

  // Bank account encryption (driver payouts) — 32-byte key, hex-encoded (64 hex chars), for AES-256-GCM
  BANK_ACCOUNT_ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-f]+$/i),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  // RazorpayX current/virtual account number to debit driver payouts from
  // (NOT the API key id — see RazorpayX dashboard > Accounts)
  RAZORPAYX_ACCOUNT_NUMBER: z.string().default(''),

  // Exotel (call masking)
  EXOTEL_SID: z.string().default(''),
  EXOTEL_API_KEY: z.string().default(''),
  EXOTEL_API_TOKEN: z.string().default(''),
  EXOTEL_SUBDOMAIN: z.string().default('api.exotel.com'),
  EXOTEL_STATUS_CALLBACK_URL: z.string().default(''),
  EXOTEL_WAIT_AUDIO_URL: z.string().default(''),
  // Shared secret checked as ?token= on the StatusCallback webhook — Exotel
  // has no HMAC signing like Razorpay's webhook, so this is the standard
  // workaround to stop arbitrary callers from injecting fake call events.
  EXOTEL_WEBHOOK_SECRET: z.string().default(''),

  // SMS
  MSG91_AUTH_KEY: z.string().default(''),
  MSG91_SENDER_ID: z.string().default(''),
  BULKSMSPLANS_API_ID: z.string().default(''),
  BULKSMSPLANS_API_PASSWORD: z.string().default(''),
  BULKSMSPLANS_SENDER_ID: z.string().default(''),
  // DLT-approved template — login OTP only (see notifications.worker.ts otp_sms handler)
  BULKSMSPLANS_OTP_TEMPLATE_ID: z.string().default(''),
  ADMIN_PHONE: z.string().default(''),

  // Push (FCM)
  FCM_SERVICE_ACCOUNT_KEY: z.string().default(''),  // full service-account JSON, single-line
  FCM_PROJECT_ID: z.string().default(''),

  // Storage
  S3_BUCKET_NAME: z.string().min(1),
  S3_REGION: z.string().default('ap-south-1'),
  // AWS SDK v3 does not auto-detect region from EC2 instance metadata the way
  // it does credentials — every client that doesn't take S3_REGION (rds-signer,
  // secrets-manager) needs this passed explicitly or it throws "region is
  // missing" at first use, not at boot.
  AWS_REGION: z.string().default('ap-south-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),

  // Email (AWS SES) — reuses the S3 AWS credentials/account, just a different service.
  // SES_FROM_EMAIL empty = dev bypass (logs instead of sending), same pattern as BULKSMSPLANS_API_ID.
  SES_REGION: z.string().default('ap-south-1'),
  SES_FROM_EMAIL: z.string().default(''),

  // App
  API_PORT: z.coerce.number().default(4000),
  API_BASE_URL: z.string().default('http://localhost:4000'),
  ADMIN_APP_URL: z.string().default('http://localhost:3002'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // BullMQ
  BULLMQ_CONCURRENCY: z.coerce.number().default(5),

  // Maps
  GOOGLE_MAPS_API_KEY: z.string().default(''),

  // Test
  TEST_DATABASE_URL: z.string().default(''),

  // Demo — set DEMO_MODE=true on staging/demo VPS to unlock demo-force endpoints
  DEMO_MODE: z.enum(['true', 'false']).default('false'),

  // Logging — 'info' in prod keeps GPS-ping-path debug logs compiled out;
  // bump to 'debug' locally when tracing socket/queue correlation.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

const envSchemaChecked = envSchema.superRefine((env, ctx) => {
  if (env.DB_AUTH_MODE === 'password' && !env.DATABASE_URL) {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'required when DB_AUTH_MODE=password' })
  }
  if (env.DB_AUTH_MODE === 'iam' && (!env.DB_HOST || !env.DB_NAME || !env.DB_USER)) {
    ctx.addIssue({ code: 'custom', path: ['DB_HOST'], message: 'DB_HOST, DB_NAME, DB_USER all required when DB_AUTH_MODE=iam' })
  }
  if (env.DB_AUTH_MODE === 'secrets-manager' && (!env.DB_HOST || !env.DB_NAME || !env.DB_USER || !env.DB_SECRET_ARN)) {
    ctx.addIssue({ code: 'custom', path: ['DB_SECRET_ARN'], message: 'DB_HOST, DB_NAME, DB_USER, DB_SECRET_ARN all required when DB_AUTH_MODE=secrets-manager' })
  }
})

function loadConfig() {
  try {
    return envSchemaChecked.parse(process.env)
  } catch (err) {
    // console here (not logger) — this fires before config exists, and the
    // logger needs config.LOG_LEVEL to construct. Fatal boot-time failure; process exits right after.
    if (err instanceof ZodError) {
      console.error('Missing or invalid environment variables:')
      for (const issue of err.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`)
      }
    } else {
      console.error(err)
    }
    process.exit(1)
  }
}

export const config = loadConfig()
export type Config = typeof config
