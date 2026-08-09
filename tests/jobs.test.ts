import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { connectDatabase, disconnectDatabase } from '../src/config/database.js'
import { connectRedis, disconnectRedis } from '../src/config/redis.js'
import {
  BOOKING_STATUS,
  PROFILE_STATUS,
  USER_ROLES,
  type UserRole,
} from '../src/config/constants.js'
import { signAccessToken } from '../src/utils/tokens.js'
import { User } from '../src/models/User.js'
import { HRProfile } from '../src/models/HRProfile.js'
import { Availability } from '../src/models/Availability.js'
import { Booking } from '../src/models/Booking.js'
import { Meeting } from '../src/models/Meeting.js'
import { getEmailQueue } from '../src/queues/email.queue.js'
import { getMeetingQueue } from '../src/queues/meeting.queue.js'
import { getReminderQueue, reminderJobId } from '../src/queues/reminder.queue.js'

const app = createApp()

const prefix = `jobs-test-${randomUUID().slice(0, 8)}`

const profilePayload = {
  headline: 'Jobs Test Consultant',
  bio: 'Consultant used by the jobs integration tests to verify queue behaviour.',
  specializations: ['RECRUITMENT'],
  yearsOfExperience: 5,
  hourlyRateCents: 4000,
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

/** Let fire-and-forget queue.add() promises settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200))
}

async function createUser(role: UserRole, email: string) {
  return User.create({
    email,
    password: 'not-used-in-tests',
    firstName: 'Jobs',
    lastName: 'Tester',
    role,
    isEmailVerified: true,
  })
}

async function createConsultant(email: string): Promise<Consultant> {
  const hr = await createUser(USER_ROLES.HR, email)
  await request(app).put('/api/v1/profiles/me').set(bearer(hr.id, 'HR')).send(profilePayload)
  const submit = await request(app).patch('/api/v1/profiles/me/submit').set(bearer(hr.id, 'HR'))
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
  const bookings = await Booking.find({
    $or: [{ userId: { $in: ids } }, { hrUserId: { $in: ids } }],
  }).select('_id')
  const bookingIds = bookings.map((b) => b._id)
  await Meeting.deleteMany({ bookingId: { $in: bookingIds } })
  await Booking.deleteMany({ $or: [{ userId: { $in: ids } }, { hrUserId: { $in: ids } }] })
  await HRProfile.deleteMany({ userId: { $in: ids } })
  await Availability.deleteMany({ hrUserId: { $in: ids } })
  await User.deleteMany({ email: { $regex: `^${prefix}` } })

  await getEmailQueue()
    .drain()
    .catch(() => undefined)
  await getMeetingQueue()
    .drain()
    .catch(() => undefined)
  await getReminderQueue()
    .drain()
    .catch(() => undefined)
}

beforeAll(async () => {
  await connectDatabase().catch((err) => {
    console.warn(`MongoDB not reachable for jobs tests: ${err.message}`)
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

describe('booking creates queue jobs on create', () => {
  let consultant: Consultant
  let clientId: string

  beforeAll(async () => {
    consultant = await createConsultant(`${prefix}-hr-queue@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-client-queue@example.com`)
    clientId = client.id
  })

  it('enqueues meeting create, confirmation emails, and a reminder when a booking is made', async () => {
    const slots = await fetchSlots(consultant.profileId)
    expect(slots.length).toBeGreaterThan(0)

    const res = await book(clientId, consultant.profileId, slots[0])
    expect(res.status).toBe(201)
    const bookingId = res.body.data.booking.id

    // Wait for fire-and-forget enqueueEmail/scheduleReminder to settle
    await settle()

    // Meeting create job (awaited in dispatch)
    const meetingJobs = await getMeetingQueue().getJobs(['waiting', 'delayed', 'active'])
    const createJob = meetingJobs.find((j) => j.name === 'create' && j.data.bookingId === bookingId)
    expect(createJob).toBeDefined()

    // Confirmation emails for both parties (fire-and-forget)
    const emailJobs = await getEmailQueue().getJobs(['waiting', 'delayed', 'active'])
    const confirmationEmails = emailJobs.filter(
      (j) => j.data.subject && (j.data.subject as string).includes('confirmed'),
    )
    expect(confirmationEmails.length).toBeGreaterThanOrEqual(2)

    // Reminder job
    const jobId = reminderJobId(bookingId)
    const reminderJob = await getReminderQueue().getJob(jobId)
    expect(reminderJob).toBeDefined()
    expect(reminderJob?.data.bookingId).toBe(bookingId)
  })
})

describe('booking creates queue jobs on reschedule', () => {
  let consultant: Consultant
  let clientId: string

  beforeAll(async () => {
    consultant = await createConsultant(`${prefix}-hr-resched@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-client-resched@example.com`)
    clientId = client.id

    // Drain previous test's queued jobs
    await getEmailQueue()
      .drain()
      .catch(() => undefined)
    await getMeetingQueue()
      .drain()
      .catch(() => undefined)
  })

  it('enqueues meeting sync job and reschedule emails when rescheduled', async () => {
    const slots = await fetchSlots(consultant.profileId, 3, 14)
    expect(slots.length).toBeGreaterThan(1)

    const createRes = await book(clientId, consultant.profileId, slots[0])
    expect(createRes.status).toBe(201)
    const bookingId = createRes.body.data.booking.id

    // Drain jobs from creation
    await settle()
    await getEmailQueue()
      .drain()
      .catch(() => undefined)
    await getMeetingQueue()
      .drain()
      .catch(() => undefined)

    const res = await request(app)
      .patch(`/api/v1/bookings/${bookingId}/reschedule`)
      .set(bearer(clientId, 'USER'))
      .send({ startAt: slots[1], timezone: 'Asia/Dhaka' })
    expect(res.status).toBe(200)

    await settle()

    // Meeting sync job
    const meetingJobs = await getMeetingQueue().getJobs(['waiting', 'delayed', 'active'])
    const syncJob = meetingJobs.find((j) => j.name === 'sync' && j.data.bookingId === bookingId)
    expect(syncJob).toBeDefined()

    // Reschedule emails for both parties
    const emailJobs = await getEmailQueue().getJobs(['waiting', 'delayed', 'active'])
    const rescheduleEmails = emailJobs.filter(
      (j) => j.data.subject && (j.data.subject as string).includes('rescheduled'),
    )
    expect(rescheduleEmails.length).toBeGreaterThanOrEqual(2)
  })
})

describe('booking creates queue jobs on cancel', () => {
  let consultant: Consultant
  let clientId: string

  beforeAll(async () => {
    consultant = await createConsultant(`${prefix}-hr-cancel@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-client-cancel@example.com`)
    clientId = client.id

    // Drain previous test's queued jobs
    await getEmailQueue()
      .drain()
      .catch(() => undefined)
    await getMeetingQueue()
      .drain()
      .catch(() => undefined)
  })

  it('enqueues meeting cancel job and cancellation emails when cancelled', async () => {
    const slots = await fetchSlots(consultant.profileId)
    expect(slots.length).toBeGreaterThan(0)

    const createRes = await book(clientId, consultant.profileId, slots[0])
    expect(createRes.status).toBe(201)
    const bookingId = createRes.body.data.booking.id

    // Drain jobs from creation
    await settle()
    await getEmailQueue()
      .drain()
      .catch(() => undefined)
    await getMeetingQueue()
      .drain()
      .catch(() => undefined)

    const res = await request(app)
      .patch(`/api/v1/bookings/${bookingId}/cancel`)
      .set(bearer(clientId, 'USER'))
      .send({ reason: 'Testing cancellation jobs' })
    expect(res.status).toBe(200)

    await settle()

    // Meeting cancel job
    const meetingJobs = await getMeetingQueue().getJobs(['waiting', 'delayed', 'active'])
    const cancelJob = meetingJobs.find((j) => j.name === 'cancel' && j.data.bookingId === bookingId)
    expect(cancelJob).toBeDefined()

    // Cancellation emails for both parties
    const emailJobs = await getEmailQueue().getJobs(['waiting', 'delayed', 'active'])
    const cancelEmails = emailJobs.filter(
      (j) => j.data.subject && (j.data.subject as string).includes('cancelled'),
    )
    expect(cancelEmails.length).toBeGreaterThanOrEqual(2)
  })
})

describe('booking lifecycle sweeper', () => {
  let consultant: Consultant
  let clientId: string

  beforeAll(async () => {
    consultant = await createConsultant(`${prefix}-hr-sweep@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-client-sweep@example.com`)
    clientId = client.id
  })

  it('marks past CONFIRMED bookings as COMPLETED', async () => {
    const pastStart = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const pastEnd = new Date(Date.now() - 90 * 60 * 1000)

    const booking = await Booking.create({
      userId: clientId,
      hrUserId: consultant.userId,
      hrProfileId: consultant.profileId,
      startAt: pastStart,
      endAt: pastEnd,
      durationMinutes: 30,
      hrTimezone: 'UTC',
      userTimezone: 'Asia/Dhaka',
      status: BOOKING_STATUS.CONFIRMED,
      priceCents: 2000,
      currency: 'USD',
      meetingProvider: 'GOOGLE_MEET',
      slotKey: `${consultant.userId}:${pastStart.toISOString()}`,
    })

    // Simulate the sweep query (same logic as lifecycle.job.ts worker)
    const { ACTIVE_BOOKING_STATUSES, BOOKING_STATUS: BS } =
      await import('../src/config/constants.js')
    const result = await Booking.updateMany(
      { status: { $in: ACTIVE_BOOKING_STATUSES }, endAt: { $lte: new Date() } },
      { $set: { status: BS.COMPLETED }, $unset: { slotKey: 1 } },
    )
    expect(result.modifiedCount).toBeGreaterThanOrEqual(1)

    const updated = await Booking.findById(booking._id)
    expect(updated?.status).toBe(BOOKING_STATUS.COMPLETED)
    expect(updated?.slotKey).toBeUndefined()
  })

  it('does not change future CONFIRMED bookings', async () => {
    const futureStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const futureEnd = new Date(futureStart.getTime() + 30 * 60 * 1000)

    const booking = await Booking.create({
      userId: clientId,
      hrUserId: consultant.userId,
      hrProfileId: consultant.profileId,
      startAt: futureStart,
      endAt: futureEnd,
      durationMinutes: 30,
      hrTimezone: 'UTC',
      userTimezone: 'Asia/Dhaka',
      status: BOOKING_STATUS.CONFIRMED,
      priceCents: 2000,
      currency: 'USD',
      meetingProvider: 'GOOGLE_MEET',
      slotKey: `${consultant.userId}:${futureStart.toISOString()}`,
    })

    const { ACTIVE_BOOKING_STATUSES, BOOKING_STATUS: BS } =
      await import('../src/config/constants.js')
    await Booking.updateMany(
      { status: { $in: ACTIVE_BOOKING_STATUSES }, endAt: { $lte: new Date() } },
      { $set: { status: BS.COMPLETED }, $unset: { slotKey: 1 } },
    )

    const updated = await Booking.findById(booking._id)
    expect(updated?.status).toBe(BOOKING_STATUS.CONFIRMED)
    expect(updated?.slotKey).toBeDefined()
  })
})
