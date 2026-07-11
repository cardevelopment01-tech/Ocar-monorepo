import { describe, it, expect } from 'vitest'
import { encryptTotpSecret, decryptTotpSecret } from '@/lib/totp-crypto'

describe('totp-crypto', () => {
  it('round-trips a secret through encrypt/decrypt', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const encrypted = encryptTotpSecret(secret)
    expect(decryptTotpSecret(encrypted)).toBe(secret)
  })

  it('produces a different ciphertext each time (random IV)', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const a = encryptTotpSecret(secret)
    const b = encryptTotpSecret(secret)
    expect(a).not.toBe(b)
    expect(decryptTotpSecret(a)).toBe(secret)
    expect(decryptTotpSecret(b)).toBe(secret)
  })

  it('rejects a tampered ciphertext (auth tag mismatch)', () => {
    const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP')
    const [iv, authTag, ciphertext] = encrypted.split(':')
    const tampered = `${iv}:${authTag}:${ciphertext!.slice(0, -2)}00`
    expect(() => decryptTotpSecret(tampered)).toThrow()
  })

  it('rejects a malformed encrypted string', () => {
    expect(() => decryptTotpSecret('not-a-valid-format')).toThrow('Malformed encrypted TOTP secret')
  })
})
