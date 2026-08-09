import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { connectDatabase, disconnectDatabase } from '../src/config/database.js'
import { connectRedis, disconnectRedis } from '../src/config/redis.js'
import { PROFILE_STATUS, USER_ROLES, type UserRole } from '../src/config/constants.js'
import { signAccessToken } from '../src/utils/tokens.js'
import { User } from '../src/models/User.js'
import { HRProfile } from '../src/models/HRProfile.js'
import { Availability } from '../src/models/Availability.js'
import { Booking, buildSlotKey } from '../src/models/Booking.js'

const app = createApp()

const prefix = `booking-test-${randomUUID().slice(0, 8)}`

const profilePayload = {
  headline: 'Booking Consultant',
  bio: 'Consultant used by the booking integration tests to verify the reservation rules.',
  specializations: ['RECRUITMENT'],
  yearsOfExperience: 9,
  hourlyRateCents: 6000,
  currency: 'USD',
  languages: ['English'],
}

const availabilityPayload = {
  timezone: 'UTC',
  slotDurationMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxAdvanceDays: 90,
  weeklyHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    intervals: [{ start: '09:00', end: '17:00' }],
  })),
  blockedDates: [],
}

interface Consultant {
  userId: string
  profileId: string
}

function bearer(userId: string, role: string): { Authorization: string } {
  return { Authorization: `Bearer ${signAccessToken(userId, role)}` }
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

async function createUser(role: UserRole, email: string) {
  return User.create({
    email,
    password: 'not-used-in-tests',
    firstName: 'Booking',
    lastName: 'Tester',
    role,
    isEmailVerified: true,
  })
}

async function createConsultant(email: string): Promise<Consultant> {
  const hr = await createUser(USER_ROLES.HR, email)
  await request(app).put('/api/v1/profiles/me').set(bearer(hr.id, 'HR')).send(profilePayload)
  const submit = await request(app).patch('/api/v1/profiles/me/submit').set(bearer(hr.id, 'HR'))
  // Admin review is exercised end-to-end in admin.test.ts; here we just need a published fixture.
  await HRProfile.findByIdAndUpdate(submit.body.data.profile.id, {
    status: PROFILE_STATUS.PUBLISHED,
  })
  await request(app)
    .put('/api/v1/availability/me')
    .set(bearer(hr.id, 'HR'))
    .send(availabilityPayload)

  return { userId: hr.id, profileId: submit.body.data.profile.id }
}

async function fetchSlots(profileId: string, fromDays = 3, toDays = 10): Promise<string[]> {
  const res = await request(app)
    .get(`/api/v1/availability/${profileId}/slots`)
    .query({ from: daysFromNow(fromDays).toISOString(), to: daysFromNow(toDays).toISOString() })

  return res.body.data.slots.map((slot: { startAt: string }) => slot.startAt)
}

function book(userId: string, profileId: string, startAt: string) {
  return request(app)
    .post('/api/v1/bookings')
    .set(bearer(userId, 'USER'))
    .send({ profileId, startAt, timezone: 'Asia/Dhaka' })
}

async function cleanup(): Promise<void> {
  const users = await User.find({ email: { $regex: `^${prefix}` } }).select('_id')
  const ids = users.map((user) => user._id)
  await Booking.deleteMany({ $or: [{ userId: { $in: ids } }, { hrUserId: { $in: ids } }] })
  await HRProfile.deleteMany({ userId: { $in: ids } })
  await Availability.deleteMany({ hrUserId: { $in: ids } })
  await User.deleteMany({ email: { $regex: `^${prefix}` } })
}

beforeAll(async () => {
  await connectDatabase().catch((err) => {
    console.warn(`MongoDB not reachable for booking tests: ${err.message}`)
  })
  await connectRedis().catch(() => undefined)
  await Booking.syncIndexes()
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await disconnectDatabase().catch(() => undefined)
  disconnectRedis()
})

describe('POST /api/v1/bookings', () => {
  it('books an offered slot and prorates the consultation fee', async () => {
    const hr = await createConsultant(`${prefix}-create-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-create-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)

    const res = await book(client.id, hr.profileId, slot)

    expect(res.status).toBe(201)
    expect(res.body.data.booking.status).toBe('CONFIRMED')
    expect(res.body.data.booking.durationMinutes).toBe(30)
    expect(res.body.data.booking.priceCents).toBe(3000)
    expect(res.body.data.booking.hrTimezone).toBe('UTC')
    expect(res.body.data.booking.userTimezone).toBe('Asia/Dhaka')
    expect(new Date(res.body.data.booking.startAt).toISOString()).toBe(slot)
    expect(res.body.data.booking.consultant.firstName).toBe('Booking')
  })

  it('rejects a second booking for the same slot', async () => {
    const hr = await createConsultant(`${prefix}-taken-hr@example.com`)
    const first = await createUser(USER_ROLES.USER, `${prefix}-taken-a@example.com`)
    const second = await createUser(USER_ROLES.USER, `${prefix}-taken-b@example.com`)
    const [slot] = await fetchSlots(hr.profileId)

    expect((await book(first.id, hr.profileId, slot)).status).toBe(201)
    const res = await book(second.id, hr.profileId, slot)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SLOT_ALREADY_BOOKED')
  })

  it('lets only one of two simultaneous requests win the slot', async () => {
    const hr = await createConsultant(`${prefix}-race-hr@example.com`)
    const first = await createUser(USER_ROLES.USER, `${prefix}-race-a@example.com`)
    const second = await createUser(USER_ROLES.USER, `${prefix}-race-b@example.com`)
    const [slot] = await fetchSlots(hr.profileId)

    const results = await Promise.all([
      book(first.id, hr.profileId, slot),
      book(second.id, hr.profileId, slot),
    ])

    const statuses = results.map((res) => res.status).sort()
    expect(statuses).toEqual([201, 409])
    expect(await Booking.countDocuments({ hrUserId: hr.userId, status: 'CONFIRMED' })).toBe(1)
  })

  it('rejects a time the consultant does not offer', async () => {
    const hr = await createConsultant(`${prefix}-offset-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-offset-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const misaligned = new Date(new Date(slot).getTime() + 5 * 60_000).toISOString()

    const res = await book(client.id, hr.profileId, misaligned)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SLOT_ALREADY_BOOKED')
  })

  it('rejects a time outside the working hours', async () => {
    const hr = await createConsultant(`${prefix}-outside-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-outside-user@example.com`)
    const midnight = `${daysFromNow(5).toISOString().slice(0, 10)}T00:00:00.000Z`

    const res = await book(client.id, hr.profileId, midnight)

    expect(res.status).toBe(409)
  })

  it('rejects booking your own profile', async () => {
    const hr = await createConsultant(`${prefix}-self-hr@example.com`)
    const [slot] = await fetchSlots(hr.profileId)

    const res = await request(app)
      .post('/api/v1/bookings')
      .set(bearer(hr.userId, 'HR'))
      .send({ profileId: hr.profileId, startAt: slot })

    expect(res.status).toBe(400)
  })

  it('rejects a client holding two consultations at the same time', async () => {
    const hrA = await createConsultant(`${prefix}-clash-a@example.com`)
    const hrB = await createConsultant(`${prefix}-clash-b@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-clash-user@example.com`)
    const [slot] = await fetchSlots(hrA.profileId)

    expect((await book(client.id, hrA.profileId, slot)).status).toBe(201)
    const res = await book(client.id, hrB.profileId, slot)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('rejects unauthenticated requests', async () => {
    const hr = await createConsultant(`${prefix}-anon-hr@example.com`)
    const [slot] = await fetchSlots(hr.profileId)

    const res = await request(app)
      .post('/api/v1/bookings')
      .send({ profileId: hr.profileId, startAt: slot })

    expect(res.status).toBe(401)
  })

  it('removes the booked slot from the public slot list', async () => {
    const hr = await createConsultant(`${prefix}-hidden-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-hidden-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)

    await book(client.id, hr.profileId, slot)

    expect(await fetchSlots(hr.profileId)).not.toContain(slot)
  })
})

describe('GET /api/v1/bookings', () => {
  it('lists the bookings of the client and of the consultant', async () => {
    const hr = await createConsultant(`${prefix}-list-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-list-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slot)

    const asClient = await request(app)
      .get('/api/v1/bookings')
      .query({ scope: 'upcoming' })
      .set(bearer(client.id, 'USER'))
    const asConsultant = await request(app)
      .get('/api/v1/bookings')
      .query({ scope: 'upcoming', role: 'hr' })
      .set(bearer(hr.userId, 'HR'))

    expect(asClient.status).toBe(200)
    expect(asClient.body.data.map((b: { id: string }) => b.id)).toContain(
      created.body.data.booking.id,
    )
    expect(asConsultant.body.data.map((b: { id: string }) => b.id)).toContain(
      created.body.data.booking.id,
    )
    expect(asConsultant.body.pagination.total).toBe(1)
  })

  it('forbids a plain user from listing consultant bookings', async () => {
    const client = await createUser(USER_ROLES.USER, `${prefix}-scope-user@example.com`)

    const res = await request(app)
      .get('/api/v1/bookings')
      .query({ role: 'hr' })
      .set(bearer(client.id, 'USER'))

    expect(res.status).toBe(403)
  })

  it('hides a booking from anyone who is not a participant', async () => {
    const hr = await createConsultant(`${prefix}-private-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-private-user@example.com`)
    const stranger = await createUser(USER_ROLES.USER, `${prefix}-private-other@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slot)

    const res = await request(app)
      .get(`/api/v1/bookings/${created.body.data.booking.id}`)
      .set(bearer(stranger.id, 'USER'))

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/bookings/:id/cancel', () => {
  it('cancels a booking and frees the slot again', async () => {
    const hr = await createConsultant(`${prefix}-cancel-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-cancel-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slot)

    const res = await request(app)
      .patch(`/api/v1/bookings/${created.body.data.booking.id}/cancel`)
      .set(bearer(client.id, 'USER'))
      .send({ reason: 'Schedule clash' })

    expect(res.status).toBe(200)
    expect(res.body.data.booking.status).toBe('CANCELLED')
    expect(res.body.data.booking.cancelledBy).toBe('USER')
    expect(await fetchSlots(hr.profileId)).toContain(slot)
  })

  it('lets the consultant cancel too', async () => {
    const hr = await createConsultant(`${prefix}-hrcancel-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-hrcancel-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slot)

    const res = await request(app)
      .patch(`/api/v1/bookings/${created.body.data.booking.id}/cancel`)
      .set(bearer(hr.userId, 'HR'))
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.data.booking.cancelledBy).toBe('HR')
  })

  it('rejects cancelling an already cancelled booking', async () => {
    const hr = await createConsultant(`${prefix}-twice-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-twice-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slot)
    const id = created.body.data.booking.id

    await request(app)
      .patch(`/api/v1/bookings/${id}/cancel`)
      .set(bearer(client.id, 'USER'))
      .send({})
    const res = await request(app)
      .patch(`/api/v1/bookings/${id}/cancel`)
      .set(bearer(client.id, 'USER'))
      .send({})

    expect(res.status).toBe(409)
  })

  it('rejects a client cancelling inside the notice window', async () => {
    const hr = await createConsultant(`${prefix}-notice-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-notice-user@example.com`)
    const startAt = new Date(Date.now() + 20 * 60_000)
    const booking = await Booking.create({
      userId: client.id,
      hrUserId: hr.userId,
      hrProfileId: hr.profileId,
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60_000),
      durationMinutes: 30,
      hrTimezone: 'UTC',
      userTimezone: 'UTC',
      priceCents: 3000,
      currency: 'USD',
      slotKey: buildSlotKey(hr.userId, startAt),
    })

    const res = await request(app)
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set(bearer(client.id, 'USER'))
      .send({})

    expect(res.status).toBe(409)
    expect(res.body.error.message).toContain('60 minutes')
  })
})

describe('PATCH /api/v1/bookings/:id/reschedule', () => {
  it('moves a booking to another free slot', async () => {
    const hr = await createConsultant(`${prefix}-move-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-move-user@example.com`)
    const slots = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slots[0])

    const res = await request(app)
      .patch(`/api/v1/bookings/${created.body.data.booking.id}/reschedule`)
      .set(bearer(client.id, 'USER'))
      .send({ startAt: slots[1] })

    expect(res.status).toBe(200)
    expect(new Date(res.body.data.booking.startAt).toISOString()).toBe(slots[1])
    expect(new Date(res.body.data.booking.previousStartAt).toISOString()).toBe(slots[0])
    expect(res.body.data.booking.rescheduleCount).toBe(1)

    const remaining = await fetchSlots(hr.profileId)
    expect(remaining).toContain(slots[0])
    expect(remaining).not.toContain(slots[1])
  })

  it('rejects moving onto a slot somebody else holds', async () => {
    const hr = await createConsultant(`${prefix}-clashmove-hr@example.com`)
    const first = await createUser(USER_ROLES.USER, `${prefix}-clashmove-a@example.com`)
    const second = await createUser(USER_ROLES.USER, `${prefix}-clashmove-b@example.com`)
    const slots = await fetchSlots(hr.profileId)
    const mine = await book(first.id, hr.profileId, slots[0])
    await book(second.id, hr.profileId, slots[1])

    const res = await request(app)
      .patch(`/api/v1/bookings/${mine.body.data.booking.id}/reschedule`)
      .set(bearer(first.id, 'USER'))
      .send({ startAt: slots[1] })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SLOT_ALREADY_BOOKED')
  })

  it('rejects rescheduling to the same time', async () => {
    const hr = await createConsultant(`${prefix}-same-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-same-user@example.com`)
    const slots = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slots[0])

    const res = await request(app)
      .patch(`/api/v1/bookings/${created.body.data.booking.id}/reschedule`)
      .set(bearer(client.id, 'USER'))
      .send({ startAt: slots[0] })

    expect(res.status).toBe(400)
  })

  it('rejects rescheduling a cancelled booking', async () => {
    const hr = await createConsultant(`${prefix}-dead-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-dead-user@example.com`)
    const slots = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slots[0])
    const id = created.body.data.booking.id
    await request(app)
      .patch(`/api/v1/bookings/${id}/cancel`)
      .set(bearer(client.id, 'USER'))
      .send({})

    const res = await request(app)
      .patch(`/api/v1/bookings/${id}/reschedule`)
      .set(bearer(client.id, 'USER'))
      .send({ startAt: slots[1] })

    expect(res.status).toBe(409)
  })
})
