import { Redis } from 'ioredis'
import { env } from './env.js'
import { logger } from './logger.js'

let client: Redis | null = null

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    })
    client.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis client error')
    })
  }
  return client
}

export async function connectRedis(): Promise<Redis> {
  const redis = getRedis()
  if (redis.status === 'ready' || redis.status === 'connecting' || redis.status === 'connect') {
    return redis
  }
  await redis.connect()
  return redis
}

export async function pingRedis(): Promise<void> {
  const redis = getRedis()
  await connectRedis()
  await redis.ping()
}

export function disconnectRedis(): void {
  if (client) {
    client.disconnect()
    client = null
  }
}
