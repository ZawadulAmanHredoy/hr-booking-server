import { env, isGoogleConfigured, isProduction } from '../config/env.js'
import { pingRedis } from '../config/redis.js'

export interface PlatformSettings {
  environment: string
  clientUrl: string
  emailTransport: string
  googleIntegrationConfigured: boolean
  redisConnected: boolean
  queuePrefix: string
  rateLimits: {
    authPerFifteenMinutes: number
    apiPerMinute: number
  }
}

/**
 * Read-only snapshot of operational config — there is no persisted settings model yet, so this
 * reflects environment/health at request time rather than anything an admin can change here.
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const redisConnected = await pingRedis()
    .then(() => true)
    .catch(() => false)

  return {
    environment: env.NODE_ENV,
    clientUrl: env.CLIENT_URL,
    emailTransport: env.EMAIL_TRANSPORT,
    googleIntegrationConfigured: isGoogleConfigured,
    redisConnected,
    queuePrefix: env.QUEUE_PREFIX,
    rateLimits: {
      authPerFifteenMinutes: isProduction ? 10 : 100,
      apiPerMinute: 120,
    },
  }
}
