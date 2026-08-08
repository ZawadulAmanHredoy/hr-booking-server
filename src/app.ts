import { randomUUID } from 'node:crypto'
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

  app.use(apiRateLimiter())

  app.use('/', routes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
