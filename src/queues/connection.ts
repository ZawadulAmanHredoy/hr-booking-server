import { getRedis } from '../config/redis.js'
import { env } from '../config/env.js'

export function getQueueConnection() {
  return getRedis()
}

/**
 * BullMQ key namespace. Every Queue *and* Worker must pass this, otherwise a process using the
 * default prefix (a dev server, say) will happily consume jobs another environment enqueued.
 */
export function getQueuePrefix(): string {
  return env.QUEUE_PREFIX
}
