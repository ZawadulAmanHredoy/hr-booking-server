import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Request } from 'express'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { errorHandler } from './middlewares/error-handler.js'
import { notFoundHandler } from './middlewares/not-found.js'
import { requestId } from './middlewares/request-id.js'
import { apiRateLimiter } from './middlewares/auth.js'
import { routes } from './routes/index.js'

export function createApp(): express.Express {
  const app = express()

  app.disable('x-powered-by')

  app.use(requestId)
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).id ?? randomUUID(),
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error'
        if (res.statusCode >= 400) return 'warn'
        return 'info'
      },
    }),
  )
  app.use(helmet())
  app.use(compression())
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '100kb' }))
  app.use(express.urlencoded({ extended: true, limit: '100kb' }))
  app.use(cookieParser())

  // Static image assets are exempt from the API rate limit — otherwise a directory page full of
  // avatars would burn through the same 120/min budget as JSON API calls.
  // Uploaded avatars are stored as absolute URLs and loaded directly from the client's origin
  // (a different port in dev), so they need to opt out of helmet's default
  // Cross-Origin-Resource-Policy: same-origin, or the browser blocks the <img> request outright.
  app.use(
    '/uploads',
    (_req, res, next) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      next()
    },
    express.static(path.join(process.cwd(), 'uploads')),
  )

  app.use(apiRateLimiter())

  app.use('/', routes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
