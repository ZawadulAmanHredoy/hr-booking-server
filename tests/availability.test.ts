import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { connectDatabase, disconnectDatabase } from '../src/config/database.js'
import { connectRedis, disconnectRedis } from '../src/config/redis.js'
import { USER_ROLES, type UserRole } from '../src/config/constants.js'
import { signAccessToken } from '../src/utils/tokens.js'
import { User } from '../src/models/User.js'
import { HRProfile } from '../src/models/HRProfile.js'
import { Availability } from '../src/models/Availability.js'

const app = createApp()

const prefix = `availability-test-${randomUUID().slice(0, 8)}`

const profilePayload = {
  headline: 'Availability Consultant',
  bio: 'Consultant used by the availability integration tests to verify scheduling rules.',
  specializations: ['HR_OPERATIONS'],
  yearsOfExperience: 8,
  hourlyRateCents: 6000,
  currency: 'USD',
  languages: ['English'],
}

const workingWeek = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  intervals: [{ start: '09:00', end: '17:00' }],
}))

const availabilityPayload = {
  timezone: 'Asia/Dhaka',
  slotDurationMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxAdvanceDays: 60,
  weeklyHours: workingWeek,
  blockedDates: [],
}

function bearer(userId: string, role: string): { Authorization: string } {
  return { Authorization: `Bearer ${signAccessToken(userId, role)}` }
}

async function createUser(role: UserRole, email: string) {
  return User.create({
    email,
    password: 'not-used-in-tests',
    firstName: 'Availability',
    lastName: 'Tester',
    role,
    isEmailVerified: true,
  })
}

async function createPublishedHr(email: string): Promise<{ userId: string; profileId: string }> {
  const hr = await createUser(USER_ROLES.HR, email)
  await request(app).put('/api/v1/profiles/me').set(bearer(hr.id, 'HR')).send(profilePayload)
  const publish = await request(app)
    .patch('/api/v1/profiles/me/publish')
    .set(bearer(hr.id, 'HR'))
    .send({ status: 'PUBLISHED' })

  return { userId: hr.id, profileId: publish.body.data.profile.id }
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

async function cleanup(): Promise<void> {
  const users = await User.find({ email: { $regex: `^${prefix}` } }).select('_id')
  const ids = users.map((user) => user._id)
  await HRProfile.deleteMany({ userId: { $in: ids } })
  await Availability.deleteMany({ hrUserId: { $in: ids } })
  await User.deleteMany({ email: { $regex: `^${prefix}` } })
}

beforeAll(async () => {
  await connectDatabase().catch((err) => {
    console.warn(`MongoDB not reachable for availability tests: ${err.message}`)
  })
  await connectRedis().catch(() => undefined)
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await disconnectDatabase().catch(() => undefined)
  disconnectRedis()
})

describe('GET /api/v1/availability/me', () => {
  it('creates an empty schedule on first read', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-default@example.com`)

    const res = await request(app).get('/api/v1/availability/me').set(bearer(hr.id, 'HR'))

    expect(res.status).toBe(200)
    expect(res.body.data.availability.timezone).toBe('UTC')
    expect(res.body.data.availability.weeklyHours).toEqual([])
    expect(res.body.data.availability.slotDurationMinutes).toBe(30)
  })

  it('forbids non-HR accounts', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-forbidden@example.com`)

    const res = await request(app).get('/api/v1/availability/me').set(bearer(user.id, 'USER'))

    expect(res.status).toBe(403)
  })

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/availability/me')

    expect(res.status).toBe(401)
  })
})

describe('PUT /api/v1/availability/me', () => {
  it('stores the weekly schedule', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-store@example.com`)

    const res = await request(app)
      .put('/api/v1/availability/me')
      .set(bearer(hr.id, 'HR'))
      .send(availabilityPayload)

    expect(res.status).toBe(200)
    expect(res.body.data.availability.timezone).toBe('Asia/Dhaka')
    expect(res.body.data.availability.weeklyHours).toHaveLength(7)
    expect(res.body.data.availability.weeklyHours[0].intervals[0]).toEqual({
      start: '09:00',
      end: '17:00',
    })
  })

  it('rejects an unknown timezone', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-tz@example.com`)

    const res = await request(app)
      .put('/api/v1/availability/me')
      .set(bearer(hr.id, 'HR'))
      .send({ ...availabilityPayload, timezone: 'Mars/Olympus' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects overlapping intervals in a day', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-overlap@example.com`)

    const res = await request(app)
      .put('/api/v1/availability/me')
      .set(bearer(hr.id, 'HR'))
      .send({
        ...availabilityPayload,
        weeklyHours: [
          {
            weekday: 1,
            intervals: [
              { start: '09:00', end: '12:00' },
              { start: '11:00', end: '13:00' },
            ],
          },
        ],
      })

    expect(res.status).toBe(400)
  })

  it('rejects an interval that ends before it starts', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-inverted@example.com`)

    const res = await request(app)
      .put('/api/v1/availability/me')
      .set(bearer(hr.id, 'HR'))
      .send({
        ...availabilityPayload,
        weeklyHours: [{ weekday: 1, intervals: [{ start: '17:00', end: '09:00' }] }],
      })

    expect(res.status).toBe(400)
  })

  it('rejects a duplicated weekday', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-dupe@example.com`)

    const res = await request(app)
      .put('/api/v1/availability/me')
      .set(bearer(hr.id, 'HR'))
      .send({
        ...availabilityPayload,
        weeklyHours: [
          { weekday: 1, intervals: [{ start: '09:00', end: '10:00' }] },
          { weekday: 1, intervals: [{ start: '11:00', end: '12:00' }] },
        ],
      })

    expect(res.status).toBe(400)
  })

  it('rejects a slot duration that is not offered', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-duration@example.com`)

    const res = await request(app)
      .put('/api/v1/availability/me')
      .set(bearer(hr.id, 'HR'))
      .send({ ...availabilityPayload, slotDurationMinutes: 37 })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/availability/:profileId/slots', () => {
  it('returns slots anchored to the consultant timezone', async () => {
    const hr = await createPublishedHr(`${prefix}-slots@example.com`)
    await request(app)
      .put('/api/v1/availability/me')
      .set(bearer(hr.userId, 'HR'))
      .send({
        ...availabilityPayload,
        weeklyHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          intervals: [{ start: '09:00', end: '10:00' }],
        })),
      })

    const res = await request(app)
      .get(`/api/v1/availability/${hr.profileId}/slots`)
      .query({ from: daysFromNow(3).toISOString(), to: daysFromNow(6).toISOString() })

    expect(res.status).toBe(200)
    expect(res.body.data.timezone).toBe('Asia/Dhaka')
    expect(res.body.data.slots.length).toBeGreaterThan(0)

    // Dhaka is UTC+6 all year, so 09:00 and 09:30 local are 03:00Z and 03:30Z.
    const times = res.body.data.slots.map((slot: { startAt: string }) =>
      new Date(slot.startAt).toISOString().slice(11, 16),
    )
    expect(new Set(times)).toEqual(new Set(['03:00', '03:30']))
  })

  it('excludes blocked dates', async () => {
    const hr = await createPublishedHr(`${prefix}-blocked@example.com`)
    const blockedDay = daysFromNow(4)
    const blockedKey = blockedDay.toISOString().slice(0, 10)

    await request(app)
      .put('/api/v1/availability/me')
      .set(bearer(hr.userId, 'HR'))
      .send({
        ...availabilityPayload,
        timezone: 'UTC',
        blockedDates: [{ date: blockedKey, reason: 'Annual leave' }],
      })

    const res = await request(app)
      .get(`/api/v1/availability/${hr.profileId}/slots`)
      .query({ from: daysFromNow(3).toISOString(), to: daysFromNow(6).toISOString() })

    const days = res.body.data.slots.map((slot: { startAt: string }) => slot.startAt.slice(0, 10))
    expect(days.length).toBeGreaterThan(0)
    expect(days).not.toContain(blockedKey)
  })

  it('returns no slots when no working hours are configured', async () => {
    const hr = await createPublishedHr(`${prefix}-empty@example.com`)

    const res = await request(app).get(`/api/v1/availability/${hr.profileId}/slots`)

    expect(res.status).toBe(200)
    expect(res.body.data.slots).toEqual([])
  })

  it('hides slots for an unpublished profile', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-draft@example.com`)
    const created = await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(hr.id, 'HR'))
      .send(profilePayload)

    const res = await request(app).get(`/api/v1/availability/${created.body.data.profile.id}/slots`)

    expect(res.status).toBe(404)
  })

  it('rejects a range longer than the allowed window', async () => {
    const hr = await createPublishedHr(`${prefix}-range@example.com`)

    const res = await request(app)
      .get(`/api/v1/availability/${hr.profileId}/slots`)
      .query({ from: daysFromNow(1).toISOString(), to: daysFromNow(40).toISOString() })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BAD_REQUEST')
  })
})
