import { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import multer from 'multer'
import { config } from '@/config'

interface PgError extends Error {
  code?: string
}

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId ?? 'unknown'

  let status: number
  let body: Record<string, unknown>

  if (err instanceof multer.MulterError) {
    status = 422
    body = err.code === 'LIMIT_FILE_SIZE'
      ? { error: 'File size exceeds 5MB limit', code: 'FILE_TOO_LARGE', requestId }
      : { error: err.message, code: 'FILE_UPLOAD_ERROR', requestId }
  } else if (typeof (err as Error & { httpStatus?: number }).httpStatus === 'number') {
    const appErr = err as Error & { httpStatus: number; appCode?: string; missing?: string[] }
    status = appErr.httpStatus
    body = { error: appErr.message, code: appErr.appCode, requestId }
    if (appErr.missing) body['missing'] = appErr.missing
  } else if (err instanceof ZodError) {
    status = 422
    body = { error: 'Validation failed', code: 'VALIDATION_ERROR', fields: err.flatten().fieldErrors, requestId }
  } else if ((err as PgError).code === '23505') {
    status = 409
    body = { error: 'Already exists', code: 'DUPLICATE_ENTRY', requestId }
  } else if ((err as PgError).code === '23503') {
    status = 409
    body = { error: 'Referenced record not found', code: 'FK_VIOLATION', requestId }
  } else {
    status = 500
    body = {
      error: config.NODE_ENV !== 'production' ? (err as Error).message : 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId,
    }
  }

  // Known 4xx (validation, not-found, forbidden, duplicate, ...) are already
  // handled correctly by the caller — logging them at error level buries real
  // 5xx bugs in expected-request noise. Only escalate actual server errors.
  //
  // Don't call req.log.error() here — pino-http's own completion logger
  // (node_modules/pino-http/logger.js) already emits one error-level log line
  // per request when `res.err || res.statusCode >= 500`, synthesizing a
  // generic placeholder error if `res.err` isn't set. Setting `res.err` here
  // makes that single log line carry the real error (message + stack via
  // pino's err serializer) instead of a second, duplicate log call.
  if (status >= 500) res.err = err as Error

  res.status(status).json(body)
}
