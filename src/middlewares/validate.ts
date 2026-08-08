import type { NextFunction, Request, Response } from 'express'
import type { ZodSchema } from 'zod'
import { ValidationError } from '../utils/http-errors.js'

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      next(new ValidationError('Invalid request.', result.error.flatten()))
      return
    }
    req.body = result.data
    next()
  }
}
