import { z, ZodError } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  // Redis
  REDIS_URL: z.string().min(1),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY_USER: z.string().default('30d'),
  JWT_REFRESH_EXPIRY_ADMIN: z.string().default('24h'),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

  // SMS
  MSG91_AUTH_KEY: z.string().default(''),
  MSG91_SENDER_ID: z.string().default(''),
  FAST2SMS_API_KEY: z.string().default(''),
  ADMIN_PHONE: z.string().default(''),

  // Storage
  S3_BUCKET_NAME: z.string().default(''),
  S3_REGION: z.string().default('ap-south-1'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  MINIO_ENDPOINT: z.string().default('http://localhost:9000'),

  // App
  API_PORT: z.coerce.number().default(4000),
  API_BASE_URL: z.string().default('http://localhost:4000'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // BullMQ
  BULLMQ_CONCURRENCY: z.coerce.number().default(5),

  // Test
  TEST_DATABASE_URL: z.string().default(''),
})

function loadConfig() {
  try {
    return envSchema.parse(process.env)
  } catch (err) {
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
