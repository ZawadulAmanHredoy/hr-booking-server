import type { NextFunction, Request, Response } from 'express'
import type { ZodSchema } from 'zod'
import { ValidationError } from '../utils/http-errors.js'

type Source = 'body' | 'query' | 'params'

function validate(schema: ZodSchema, source: Source) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      next(new ValidationError('Invalid request.', result.error.flatten()))
      return
    }
    if (source === 'body') {
      req.body = result.data
    } else {
      // Express 5 exposes req.query / req.params as getter-only properties, so a
      // plain assignment throws. Shadow them with an own property instead.
      const name = source === 'query' ? 'query' : 'params'
      Object.defineProperty(req, name, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      })
    }
    next()
  }
}

export function validateBody(schema: ZodSchema) {
  return validate(schema, 'body')
}

export function validateQuery(schema: ZodSchema) {
  return validate(schema, 'query')
}

export function validateParams(schema: ZodSchema) {
  return validate(schema, 'params')
}
