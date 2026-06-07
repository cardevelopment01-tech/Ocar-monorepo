import { RequestHandler } from 'express'
import { ZodSchema, ZodError } from 'zod'

export function validate(schema: ZodSchema): RequestHandler {
  return (req, res, next) => {
    try {
      schema.parse(req.body)
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(422).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          fields: err.flatten().fieldErrors,
        })
        return
      }
      next(err)
    }
  }
}
