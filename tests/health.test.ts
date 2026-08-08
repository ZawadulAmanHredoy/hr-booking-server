import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { connectDatabase, disconnectDatabase } from '../src/config/database.js'
import { connectRedis, disconnectRedis } from '../src/config/redis.js'

const app = createApp()

beforeAll(async () => {
  await connectDatabase().catch((err) => {
    console.warn(`MongoDB not reachable for health tests: ${err.message}`)
  })
  await connectRedis().catch(() => undefined)
})

afterAll(async () => {
  await disconnectDatabase().catch(() => undefined)
  disconnectRedis()
})

describe('Health endpoints', () => {
  it('GET /health returns liveness with uptime', async () => {
    const res = await request(app).get('/health')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('ok')
    expect(res.body.data.uptime).toBeTypeOf('number')
  })

  it('GET /health/ready returns dependency checks', async () => {
    const res = await request(app).get('/health/ready')

    expect([200, 503]).toContain(res.status)
    expect(res.body.success).toBeTypeOf('boolean')
    expect(res.body.data.status).toBe('ready')
    expect(res.body.data.checks).toBeInstanceOf(Array)
    const names = res.body.data.checks.map((check: { name: string }) => check.name)
    expect(names).toContain('mongodb')
    expect(names).toContain('redis')
  })

  it('attaches an X-Request-Id header to every response', async () => {
    const res = await request(app).get('/health')

    expect(res.headers['x-request-id']).toBeDefined()
  })

  it('returns a consistent JSON error for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist')

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})
