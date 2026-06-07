import { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import multer from 'multer'
import { config } from '@/config'

interface PgError extends Error {
  code?: string
}

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId ?? 'unknown'
  console.error(`[${requestId}] Error:`, err)

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(422).json({ error: 'File size exceeds 5MB limit', code: 'FILE_TOO_LARGE', requestId })
    } else {
      res.status(422).json({ error: err.message, code: 'FILE_UPLOAD_ERROR', requestId })
    }
    return
  }

  const appErr = err as Error & { httpStatus?: number; appCode?: string; missing?: string[] }
  if (typeof appErr.httpStatus === 'number') {
    const body: Record<string, unknown> = { error: appErr.message, code: appErr.appCode, requestId }
    if (appErr.missing) body['missing'] = appErr.missing
    res.status(appErr.httpStatus).json(body)
    return
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      fields: err.flatten().fieldErrors,
      requestId,
    })
    return
  }

  const pgErr = err as PgError

  if (pgErr.code === '23505') {
    res.status(409).json({
      error: 'Already exists',
      code: 'DUPLICATE_ENTRY',
      requestId,
    })
    return
  }

  if (pgErr.code === '23503') {
    res.status(409).json({
      error: 'Referenced record not found',
      code: 'FK_VIOLATION',
      requestId,
    })
    return
  }

  const message =
    config.NODE_ENV !== 'production'
      ? (err as Error).message
      : 'Internal server error'

  res.status(500).json({
    error: message,
    code: 'INTERNAL_ERROR',
    requestId,
  })
}
