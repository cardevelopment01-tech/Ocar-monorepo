import { describe, it, expect } from 'vitest'
import { envSchemaChecked } from '@/config'

// tests/setup.ts provides every other required env var; override only what matters.
const base = { ...process.env }
const urls = {
  API_BASE_URL: 'https://api.example.com',
  USER_APP_URL: 'https://app.example.com',
  DRIVER_APP_URL: 'https://driver.example.com',
}
const sms = { BULKSMSPLANS_API_ID: 'id', BULKSMSPLANS_API_PASSWORD: 'pw' }
const prod = { ...base, NODE_ENV: 'production', PAYU_KEY: 'k', PAYU_SALT: 's', ...urls, ...sms }

describe('SMS prod boot guard', () => {
  it('refuses production without SMS credentials (the dev bypass would log every login OTP)', () => {
    expect(envSchemaChecked.safeParse({ ...prod, BULKSMSPLANS_API_ID: '', BULKSMSPLANS_API_PASSWORD: '' }).success).toBe(false)
    expect(envSchemaChecked.safeParse({ ...prod, BULKSMSPLANS_API_PASSWORD: '' }).success).toBe(false)
  })
  it('allows production with SMS credentials', () => {
    expect(envSchemaChecked.safeParse(prod).success).toBe(true)
  })
  it('ALLOW_DEV_SMS=true lets a non-production environment that runs NODE_ENV=production boot without them', () => {
    const r = envSchemaChecked.safeParse({ ...prod, BULKSMSPLANS_API_ID: '', BULKSMSPLANS_API_PASSWORD: '', ALLOW_DEV_SMS: 'true' })
    expect(r.success).toBe(true)
  })
  it('ALLOW_DEV_SMS defaults to off', () => {
    expect(envSchemaChecked.safeParse(prod).data?.ALLOW_DEV_SMS).toBe('false')
  })
  it('development never needs SMS credentials', () => {
    const r = envSchemaChecked.safeParse({ ...base, NODE_ENV: 'development', BULKSMSPLANS_API_ID: '', BULKSMSPLANS_API_PASSWORD: '' })
    expect(r.success).toBe(true)
  })
})

describe('PayU prod boot guard', () => {
  it('refuses production without PayU keys', () => {
    expect(envSchemaChecked.safeParse({ ...prod, PAYU_KEY: '', PAYU_SALT: '' }).success).toBe(false)
  })
  it('allows production with both keys and https URLs', () => {
    expect(envSchemaChecked.safeParse(prod).success).toBe(true)
  })
  it.each(['API_BASE_URL', 'USER_APP_URL', 'DRIVER_APP_URL'])('refuses production with localhost %s', (k) => {
    expect(envSchemaChecked.safeParse({ ...prod, [k]: 'https://localhost:3000' }).success).toBe(false)
    expect(envSchemaChecked.safeParse({ ...prod, [k]: 'https://127.0.0.1' }).success).toBe(false)
  })
  it.each(['API_BASE_URL', 'USER_APP_URL', 'DRIVER_APP_URL'])('refuses production with http %s', (k) => {
    expect(envSchemaChecked.safeParse({ ...prod, [k]: 'http://x.example.com' }).success).toBe(false)
  })
  it('allows development without keys or https URLs (dev auto-confirm path)', () => {
    const r = envSchemaChecked.safeParse({
      ...base, NODE_ENV: 'development', PAYU_KEY: '', PAYU_SALT: '',
      API_BASE_URL: 'http://localhost:4000', USER_APP_URL: 'http://localhost:3000', DRIVER_APP_URL: 'http://localhost:5173',
    })
    expect(r.success).toBe(true)
  })
})

describe('URL normalization', () => {
  it.each(['API_BASE_URL', 'USER_APP_URL', 'DRIVER_APP_URL'] as const)('strips trailing slashes from %s', (k) => {
    const r = envSchemaChecked.safeParse({ ...prod, [k]: 'https://x.example.com//' })
    expect(r.success).toBe(true)
    expect(r.data?.[k]).toBe('https://x.example.com')
  })
  it('the prod guard still sees the normalized value', () => {
    expect(envSchemaChecked.safeParse({ ...prod, API_BASE_URL: 'https://localhost/' }).success).toBe(false)
  })
})
