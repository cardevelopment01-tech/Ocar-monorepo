import { RequestHandler } from 'express'
import { AppErrors } from '@/constants/errors'
import type { DriverStatus, AdminRole } from '@/constants/enums'

export function requireUser(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({
        error: AppErrors.AUTH_UNAUTHORIZED.message,
        code: AppErrors.AUTH_UNAUTHORIZED.code,
      })
      return
    }
    if (req.user.status === 'suspended' || req.user.status === 'deleted') {
      res.status(403).json({
        error: AppErrors.AUTH_FORBIDDEN.message,
        code: AppErrors.AUTH_FORBIDDEN.code,
      })
      return
    }
    next()
  }
}

const DRIVER_STATUS_ERRORS: Partial<Record<DriverStatus, (typeof AppErrors)[keyof typeof AppErrors]>> = {
  pending_docs: AppErrors.DRIVER_ONBOARDING_INCOMPLETE,
  pending_approval: AppErrors.DRIVER_NOT_APPROVED,
  docs_rejected: AppErrors.DRIVER_DOCS_REJECTED,
  suspended: AppErrors.DRIVER_SUSPENDED,
}

export function requireDriver(...allowedStatuses: DriverStatus[]): RequestHandler {
  return (req, res, next) => {
    if (!req.driver) {
      res.status(401).json({
        error: AppErrors.AUTH_UNAUTHORIZED.message,
        code: AppErrors.AUTH_UNAUTHORIZED.code,
      })
      return
    }
    if (allowedStatuses.length > 0 && !allowedStatuses.includes(req.driver.status as DriverStatus)) {
      // Say *why* the driver is blocked so clients can show a real message
      // instead of a bare 403.
      const err = DRIVER_STATUS_ERRORS[req.driver.status as DriverStatus] ?? AppErrors.AUTH_FORBIDDEN
      res.status(403).json({ error: err.message, code: err.code })
      return
    }
    next()
  }
}

export function requireAdmin(...allowedRoles: AdminRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.admin) {
      res.status(401).json({
        error: AppErrors.AUTH_UNAUTHORIZED.message,
        code: AppErrors.AUTH_UNAUTHORIZED.code,
      })
      return
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.admin.role as AdminRole)) {
      res.status(403).json({
        error: AppErrors.AUTH_FORBIDDEN.message,
        code: AppErrors.AUTH_FORBIDDEN.code,
      })
      return
    }
    next()
  }
}
