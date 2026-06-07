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
