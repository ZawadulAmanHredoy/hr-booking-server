import mongoose from 'mongoose'
import { getRedis } from '../config/redis.js'

export interface DependencyCheck {
  name: string
  status: 'ok' | 'down'
  error?: string
}

export async function checkDependencies(): Promise<DependencyCheck[]> {
  const checks: DependencyCheck[] = []

  const mongoConnected = mongoose.connection.readyState === 1
  checks.push({
    name: 'mongodb',
    status: mongoConnected ? 'ok' : 'down',
    ...(mongoConnected ? {} : { error: 'Not connected' }),
  })

  try {
    const redis = getRedis()
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      await redis.connect()
    }
    await redis.ping()
    checks.push({ name: 'redis', status: 'ok' })
  } catch (err) {
    checks.push({
      name: 'redis',
      status: 'down',
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }

  return checks
}
