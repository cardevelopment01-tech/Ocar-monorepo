import { describe, it, expect } from 'vitest'
import { envSchemaChecked } from '@/config'

// tests/setup.ts provides every other required env var; override only what matters.
const base = { ...process.env }
const urls = {
  API_BASE_URL: 'https://api.example.com',
  USER_APP_URL: 'https://app.example.com',
  DRIVER_APP_URL: 'https://driver.example.com',
}
const prod = { ...base, NODE_ENV: 'production', PAYU_KEY: 'k', PAYU_SALT: 's', ...urls }

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
