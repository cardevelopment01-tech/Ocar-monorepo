import { RequestHandler } from 'express'
import { verifyAccessToken } from '@/lib/jwt'
import { AppErrors } from '@/constants/errors'
import { PrincipalRole } from '@/constants/enums'
import {
  findUserById,
  findDriverById,
  findAdminById,
} from '@/modules/auth/auth.repository'

export function authenticate(): RequestHandler {
  return async (req, res, next) => {
    const authHeader = req.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        error: AppErrors.AUTH_UNAUTHORIZED.message,
        code: AppErrors.AUTH_UNAUTHORIZED.code,
      })
      return
    }

    const token = authHeader.slice(7)
    try {
      const payload = verifyAccessToken(token)
      const id = BigInt(payload.sub)

      if (payload.role === PrincipalRole.USER) {
        const user = await findUserById(id)
        if (!user || user.status === 'deleted') {
          res.status(401).json({
            error: AppErrors.AUTH_TOKEN_INVALID.message,
            code: AppErrors.AUTH_TOKEN_INVALID.code,
          })
          return
        }
        req.user = { id: BigInt(user.id), code: user.code, role: 'user', status: user.status }
      } else if (payload.role === PrincipalRole.DRIVER) {
        const driver = await findDriverById(id)
        if (!driver || driver.status === 'banned') {
          res.status(401).json({
            error: AppErrors.AUTH_TOKEN_INVALID.message,
            code: AppErrors.AUTH_TOKEN_INVALID.code,
          })
          return
        }
        req.driver = { id: BigInt(driver.id), code: driver.code, role: 'driver', status: driver.status }
      } else if (payload.role === PrincipalRole.ADMIN) {
        const admin = await findAdminById(id)
        if (!admin || !admin.is_active) {
          res.status(401).json({
            error: AppErrors.AUTH_TOKEN_INVALID.message,
            code: AppErrors.AUTH_TOKEN_INVALID.code,
          })
          return
        }
        req.admin = { id: BigInt(admin.id), code: admin.code, role: admin.role }
      }

      next()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('jwt expired') || msg.includes('TokenExpiredError')) {
        res.status(401).json({
          error: AppErrors.AUTH_TOKEN_EXPIRED.message,
          code: AppErrors.AUTH_TOKEN_EXPIRED.code,
        })
      } else {
        res.status(401).json({
          error: AppErrors.AUTH_TOKEN_INVALID.message,
          code: AppErrors.AUTH_TOKEN_INVALID.code,
        })
      }
    }
  }
}
