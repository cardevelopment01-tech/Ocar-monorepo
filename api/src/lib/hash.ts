import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { BCRYPT_ROUNDS } from '@/constants/limits'

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

// Constant-time HMAC signature check. `received` may be missing/malformed
// client input, so it's validated as a non-empty string before Buffer
// conversion — Buffer.from(undefined) throws, which previously surfaced as
// an uncaught 500 instead of a clean "invalid signature" result.
export function verifyHmacSignature(secret: string, message: string | Buffer, received: unknown): boolean {
  if (typeof received !== 'string' || received.length === 0) return false
  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex')
  const receivedBuf = Buffer.from(received)
  const expectedBuf = Buffer.from(expected)
  return receivedBuf.length === expectedBuf.length && crypto.timingSafeEqual(receivedBuf, expectedBuf)
}
