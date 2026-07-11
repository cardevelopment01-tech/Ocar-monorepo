import { describe, it, expect } from 'vitest'
import { generateRecoveryCode } from '@/modules/admin-totp/admin-totp.service'

describe('generateRecoveryCode', () => {
  it('produces the XXXX-XXXX format', () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })

  it('never uses ambiguous characters (0/O, 1/I)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRecoveryCode()
      expect(code).not.toMatch(/[01OI]/)
    }
  })

  it('generates distinct codes across many calls', () => {
    const codes = new Set(Array.from({ length: 500 }, generateRecoveryCode))
    expect(codes.size).toBe(500)
  })
})
