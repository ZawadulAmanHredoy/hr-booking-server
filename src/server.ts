import { createServer } from 'node:http'
import { createApp } from './app.js'
import { connectDatabase, disconnectDatabase } from './config/database.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { connectRedis, disconnectRedis } from './config/redis.js'

async function bootstrap(): Promise<void> {
  await connectDatabase()
  try {
    await connectRedis()
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'Redis unavailable at startup')
  }

  const app = createApp()
  const server = createServer(app)

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'HR Booking API started')
  })

  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'Graceful shutdown initiated')

    const forceExit = setTimeout(() => {
      logger.error('Forced shutdown after timeout')
      process.exit(1)
    }, 10_000)
    forceExit.unref()

    server.close(() => {
      disconnectRedis()
      void disconnectDatabase()
        .catch((err) => {
          logger.error({ err: err instanceof Error ? err.message : err }, 'Error closing MongoDB')
        })
        .finally(() => {
          logger.info('Shutdown complete')
          process.exit(0)
        })
    })
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

void bootstrap().catch((err) => {
  logger.fatal({ err: err instanceof Error ? err.message : err }, 'Failed to start server')
  process.exit(1)
})
