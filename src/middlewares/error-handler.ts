import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { AppError } from '../utils/http-errors.js'

interface PayloadTooLargeError extends Error {
  type?: string
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    })
    return
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request.',
        details: err.flatten(),
      },
    })
    return
  }

  const bodyParserError = err as PayloadTooLargeError
  if (bodyParserError.type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large.' },
    })
    return
  }

  logger.error({ err, requestId: req.id }, 'Unhandled error')

  const message =
    env.NODE_ENV === 'production'
      ? 'Internal server error.'
      : err instanceof Error
        ? err.message
        : 'Internal server error.'

  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_SERVER_ERROR', message },
  })
}
