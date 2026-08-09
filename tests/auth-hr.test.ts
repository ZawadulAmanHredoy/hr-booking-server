import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { connectDatabase, disconnectDatabase } from '../src/config/database.js'
import { connectRedis, disconnectRedis } from '../src/config/redis.js'
import { User } from '../src/models/User.js'
import { HRProfile } from '../src/models/HRProfile.js'

const app = createApp()

const baseEmail = `auth-hr-test-${randomUUID().slice(0, 8)}`

function registerHrPayload(email: string) {
  return {
    email,
    password: 'StrongPass123!',
    firstName: 'Consultant',
    lastName: 'Tester',
    phone: '+1 555 0100',
    headline: 'Senior HR Business Partner',
    bio: 'Ten years helping companies build better HR practices.',
    specializations: ['RECRUITMENT'],
    yearsOfExperience: 10,
    companyName: 'Acme Corp',
    hourlyRateCents: 5000,
    currency: 'USD',
    languages: ['English'],
    workHistory: [
      {
        company: 'Acme Corp',
        role: 'Senior HR Business Partner',
        startYear: 2020,
      },
    ],
  }
}

async function cleanup(): Promise<void> {
  const users = await User.find({ email: { $regex: `^${baseEmail}` } }).select('_id')
  const ids = users.map((user) => user._id)
  await HRProfile.deleteMany({ userId: { $in: ids } })
  await User.deleteMany({ email: { $regex: `^${baseEmail}` } })
}

beforeAll(async () => {
  await connectDatabase().catch((err) => {
    console.warn(`MongoDB not reachable for auth-hr tests: ${err.message}`)
  })
  await connectRedis().catch(() => undefined)
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await disconnectDatabase().catch(() => undefined)
  disconnectRedis()
})

describe('POST /api/v1/auth/register-hr', () => {
  it('creates the account as HR directly, with a DRAFT profile, no USER intermediate', async () => {
    const email = `${baseEmail}@example.com`
    const res = await request(app).post('/api/v1/auth/register-hr').send(registerHrPayload(email))

    expect(res.status).toBe(201)
    expect(res.body.data.user.email).toBe(email)
    expect(res.body.data.user.role).toBe('HR')

    const user = await User.findOne({ email })
    expect(user?.role).toBe('HR')
    expect(user?.phone).toBe('+1 555 0100')

    const profile = await HRProfile.findOne({ userId: user?._id })
    expect(profile).not.toBeNull()
    expect(profile?.status).toBe('DRAFT')
    expect(profile?.companyName).toBe('Acme Corp')
    expect(profile?.workHistory).toHaveLength(1)
  })

  it('rejects a duplicate email with 409', async () => {
    const email = `${baseEmail}@example.com`
    const res = await request(app).post('/api/v1/auth/register-hr').send(registerHrPayload(email))

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('rejects a payload missing required professional fields with 400', async () => {
    const email = `${baseEmail}-invalid@example.com`
    const payload = registerHrPayload(email) as Record<string, unknown>
    delete payload.companyName

    const res = await request(app).post('/api/v1/auth/register-hr').send(payload)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
