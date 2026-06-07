import jwt from 'jsonwebtoken'
import type { PrincipalRole, AdminRole } from '@/constants/enums'

function secret(): string {
  return process.env['JWT_ACCESS_SECRET'] ?? 'test-secret'
}

interface TokenOptions {
  sub: string
  code: string
  role: PrincipalRole
  status?: string
  adminRole?: AdminRole
  expiresIn?: string | number
}

function makeToken(opts: TokenOptions): string {
  const { sub, expiresIn = '15m', ...rest } = opts
  // jwt.sign's overloads require expiresIn to be a non-undefined value
  const signOpts: jwt.SignOptions = { subject: sub }
  if (expiresIn !== undefined) signOpts.expiresIn = expiresIn as jwt.SignOptions['expiresIn']
  return jwt.sign(rest, secret(), signOpts)
}

export function makeUserToken(id: string, code = 'USR000001', status = 'active'): string {
  return makeToken({ sub: id, code, role: 'user', status })
}

export function makeDriverToken(id: string, code = 'DRV000001', status = 'active'): string {
  return makeToken({ sub: id, code, role: 'driver', status })
}

export function makeAdminToken(
  id: string,
  code = 'ADM000001',
  adminRole: AdminRole = 'super_admin'
): string {
  return makeToken({ sub: id, code, role: 'admin', adminRole })
}

export function makeExpiredToken(id: string, role: PrincipalRole = 'user'): string {
  return makeToken({ sub: id, code: 'TST000001', role, expiresIn: -1 })
}
