import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { connectDatabase, disconnectDatabase } from '../src/config/database.js'
import { connectRedis, disconnectRedis } from '../src/config/redis.js'
import { OAUTH_PROVIDERS, USER_ROLES, type UserRole } from '../src/config/constants.js'
import { signAccessToken } from '../src/utils/tokens.js'
import { encryptSecret } from '../src/utils/crypto.js'
import { User } from '../src/models/User.js'
import { HRProfile } from '../src/models/HRProfile.js'
import { Availability } from '../src/models/Availability.js'
import { Booking } from '../src/models/Booking.js'
import { Meeting } from '../src/models/Meeting.js'
import { OAuthAccount } from '../src/models/OAuthAccount.js'
import {
  ensureMeetingForBooking,
  syncMeetingTimes,
  cancelMeetingForBooking,
} from '../src/services/meeting.service.js'

const app = createApp()

const prefix = `meeting-test-${randomUUID().slice(0, 8)}`
const MEET_URL = 'https://meet.google.com/abc-defg-hij'

const profilePayload = {
  headline: 'Meeting Consultant',
  bio: 'Consultant used by the meeting integration tests to verify Google Meet creation.',
  specializations: ['HR_OPERATIONS'],
  yearsOfExperience: 7,
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

interface RecordedCall {
  url: string
  method: string
  body: Record<string, unknown> | null
}

const calls: RecordedCall[] = []
let calendarFailureStatus: number | null = null

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function fakeGoogle(input: unknown, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const method = init?.method ?? 'GET'
  let body: Record<string, unknown> | null = null
  if (typeof init?.body === 'string' && init.body.startsWith('{')) {
    body = JSON.parse(init.body) as Record<string, unknown>
  }
  calls.push({ url, method, body })

  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return json({ access_token: 'access-token-1', expires_in: 3600, scope: 'calendar.events' })
  }
  if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
    return json({})
  }
  if (url.includes('/calendar/v3/')) {
    if (calendarFailureStatus) {
      return json({ error: { message: 'Calendar is unavailable.' } }, calendarFailureStatus)
    }
    if (method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    return json({ id: 'evt_1', hangoutLink: MEET_URL, htmlLink: 'https://calendar.google.com/e' })
  }

  return json({ error: { message: `Unexpected call to ${url}` } }, 500)
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
    firstName: 'Meeting',
    lastName: 'Tester',
    role,
    isEmailVerified: true,
  })
}

async function createConsultant(
  email: string,
  options: { connectGoogle?: boolean } = {},
): Promise<{ userId: string; profileId: string }> {
  const hr = await createUser(USER_ROLES.HR, email)
  await request(app).put('/api/v1/profiles/me').set(bearer(hr.id, 'HR')).send(profilePayload)
  const publish = await request(app)
    .patch('/api/v1/profiles/me/publish')
    .set(bearer(hr.id, 'HR'))
    .send({ status: 'PUBLISHED' })
  await request(app)
    .put('/api/v1/availability/me')
    .set(bearer(hr.id, 'HR'))
    .send(availabilityPayload)

  if (options.connectGoogle !== false) {
    await OAuthAccount.create({
      userId: hr.id,
      provider: OAUTH_PROVIDERS.GOOGLE,
      providerAccountId: `google-${randomUUID().slice(0, 8)}`,
      accountEmail: 'consultant@gmail.com',
      refreshToken: encryptSecret('refresh-token-value'),
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    })
  }

  return { userId: hr.id, profileId: publish.body.data.profile.id }
}

async function fetchSlots(profileId: string): Promise<string[]> {
  const res = await request(app)
    .get(`/api/v1/availability/${profileId}/slots`)
    .query({ from: daysFromNow(3).toISOString(), to: daysFromNow(10).toISOString() })

  return res.body.data.slots.map((slot: { startAt: string }) => slot.startAt)
}

function book(userId: string, profileId: string, startAt: string) {
  return request(app)
    .post('/api/v1/bookings')
    .set(bearer(userId, 'USER'))
    .send({ profileId, startAt })
}

async function cleanup(): Promise<void> {
  const users = await User.find({ email: { $regex: `^${prefix}` } }).select('_id')
  const ids = users.map((user) => user._id)
  const bookings = await Booking.find({
    $or: [{ userId: { $in: ids } }, { hrUserId: { $in: ids } }],
  }).select('_id')
  await Meeting.deleteMany({ bookingId: { $in: bookings.map((b) => b._id) } })
  await Booking.deleteMany({ _id: { $in: bookings.map((b) => b._id) } })
  await OAuthAccount.deleteMany({ userId: { $in: ids } })
  await HRProfile.deleteMany({ userId: { $in: ids } })
  await Availability.deleteMany({ hrUserId: { $in: ids } })
  await User.deleteMany({ email: { $regex: `^${prefix}` } })
}

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(fakeGoogle))
  await connectDatabase().catch((err) => {
    console.warn(`MongoDB not reachable for meeting tests: ${err.message}`)
  })
  await connectRedis().catch(() => undefined)
  await Booking.syncIndexes()
  await Meeting.syncIndexes()
  await cleanup()
})

afterEach(() => {
  calls.length = 0
  calendarFailureStatus = null
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await cleanup()
  await disconnectDatabase().catch(() => undefined)
  disconnectRedis()
})

describe('Meeting creation on booking', () => {
  it('creates a Google Meet conference and returns the join link', async () => {
    const hr = await createConsultant(`${prefix}-create@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-create-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)

    const res = await book(client.id, hr.profileId, slot)
    expect(res.status).toBe(201)
    const bookingId = res.body.data.booking.id

    await ensureMeetingForBooking(bookingId)
    const detail = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set(bearer(client.id, 'USER'))

    expect(detail.body.data.booking.meeting.status).toBe('CREATED')
    expect(detail.body.data.booking.meeting.provider).toBe('GOOGLE_MEET')
    expect(detail.body.data.booking.meeting.meetingUrl).toBe(MEET_URL)
    expect(detail.body.data.booking.canRetryMeeting).toBe(false)
  })

  it('asks Google for a hangoutsMeet conference with both attendees', async () => {
    const hr = await createConsultant(`${prefix}-payload@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-payload-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)

    const res = await book(client.id, hr.profileId, slot)
    calls.length = 0
    await ensureMeetingForBooking(res.body.data.booking.id)

    const insert = calls.find((call) => call.method === 'POST' && call.url.includes('/events'))
    expect(insert).toBeDefined()
    expect(insert?.url).toContain('conferenceDataVersion=1')

    const conference = insert?.body?.conferenceData as {
      createRequest?: { requestId?: string; conferenceSolutionKey?: { type?: string } }
    }
    expect(conference?.createRequest?.conferenceSolutionKey?.type).toBe('hangoutsMeet')
    expect(conference?.createRequest?.requestId).toMatch(/^booking-[a-f\d]{24}$/)

    const attendees = insert?.body?.attendees as { email: string }[]
    expect(attendees.map((a) => a.email).sort()).toEqual(
      [`${prefix}-payload@example.com`, `${prefix}-payload-user@example.com`].sort(),
    )
  })

  it('refreshes the access token before calling the calendar', async () => {
    const hr = await createConsultant(`${prefix}-refresh@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-refresh-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)

    const res = await book(client.id, hr.profileId, slot)
    calls.length = 0
    await ensureMeetingForBooking(res.body.data.booking.id)

    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token')
    const stored = await OAuthAccount.findOne({ userId: hr.userId })
    expect(stored?.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now())
  })

  it('keeps the booking when the consultant never connected Google', async () => {
    const hr = await createConsultant(`${prefix}-noauth@example.com`, { connectGoogle: false })
    const client = await createUser(USER_ROLES.USER, `${prefix}-noauth-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)

    const res = await book(client.id, hr.profileId, slot)
    const bookingId = res.body.data.booking.id
    await ensureMeetingForBooking(bookingId)

    const detail = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set(bearer(client.id, 'USER'))

    expect(res.status).toBe(201)
    expect(detail.body.data.booking.status).toBe('CONFIRMED')
    expect(detail.body.data.booking.meeting.status).toBe('FAILED')
    expect(detail.body.data.booking.meeting.lastError).toContain('has not connected')
    expect(detail.body.data.booking.canRetryMeeting).toBe(true)
  })

  it('keeps the booking when Google is failing', async () => {
    const hr = await createConsultant(`${prefix}-outage@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-outage-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    calendarFailureStatus = 500

    const res = await book(client.id, hr.profileId, slot)
    const bookingId = res.body.data.booking.id
    await ensureMeetingForBooking(bookingId)

    const detail = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set(bearer(client.id, 'USER'))

    expect(res.status).toBe(201)
    expect(detail.body.data.booking.status).toBe('CONFIRMED')
    expect(detail.body.data.booking.meeting.status).toBe('FAILED')
    expect(detail.body.data.booking.meeting.lastError).toContain('Calendar is unavailable')
  })
})

describe('POST /api/v1/bookings/:id/meeting/retry', () => {
  it('creates the conference after the provider recovers', async () => {
    const hr = await createConsultant(`${prefix}-retry@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-retry-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    calendarFailureStatus = 503
    const created = await book(client.id, hr.profileId, slot)
    const bookingId = created.body.data.booking.id
    await ensureMeetingForBooking(bookingId)

    const failDetail = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set(bearer(client.id, 'USER'))
    expect(failDetail.body.data.booking.meeting.status).toBe('FAILED')

    calendarFailureStatus = null
    const res = await request(app)
      .post(`/api/v1/bookings/${bookingId}/meeting/retry`)
      .set(bearer(client.id, 'USER'))

    expect(res.status).toBe(200)
    expect(res.body.data.booking.meeting.status).toBe('CREATED')
    expect(res.body.data.booking.meeting.meetingUrl).toBe(MEET_URL)
  })

  it('refuses when the meeting already exists', async () => {
    const hr = await createConsultant(`${prefix}-noretry@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-noretry-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slot)
    const bookingId = created.body.data.booking.id
    await ensureMeetingForBooking(bookingId)

    const res = await request(app)
      .post(`/api/v1/bookings/${bookingId}/meeting/retry`)
      .set(bearer(client.id, 'USER'))

    expect(res.status).toBe(409)
  })

  it('hides the booking from non-participants', async () => {
    const hr = await createConsultant(`${prefix}-stranger@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-stranger-user@example.com`)
    const stranger = await createUser(USER_ROLES.USER, `${prefix}-stranger-other@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slot)

    const res = await request(app)
      .post(`/api/v1/bookings/${created.body.data.booking.id}/meeting/retry`)
      .set(bearer(stranger.id, 'USER'))

    expect(res.status).toBe(404)
  })
})

describe('Meeting follows the booking lifecycle', () => {
  it('moves the calendar event when the booking is rescheduled', async () => {
    const hr = await createConsultant(`${prefix}-move@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-move-user@example.com`)
    const slots = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slots[0])
    const bookingId = created.body.data.booking.id
    await ensureMeetingForBooking(bookingId)
    calls.length = 0

    await request(app)
      .patch(`/api/v1/bookings/${bookingId}/reschedule`)
      .set(bearer(client.id, 'USER'))
      .send({ startAt: slots[1] })

    await syncMeetingTimes(bookingId)
    const res = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set(bearer(client.id, 'USER'))

    expect(res.status).toBe(200)
    expect(res.body.data.booking.meeting.status).toBe('CREATED')

    const patch = calls.find((call) => call.method === 'PATCH')
    expect(patch?.url).toContain('/events/evt_1')
    const start = patch?.body?.start as { dateTime?: string }
    expect(new Date(start?.dateTime as string).toISOString()).toBe(slots[1])
  })

  it('removes the calendar event when the booking is cancelled', async () => {
    const hr = await createConsultant(`${prefix}-cancel@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-cancel-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slot)
    const bookingId = created.body.data.booking.id
    await ensureMeetingForBooking(bookingId)
    calls.length = 0

    await request(app)
      .patch(`/api/v1/bookings/${bookingId}/cancel`)
      .set(bearer(client.id, 'USER'))
      .send({})

    await cancelMeetingForBooking(bookingId)
    const res = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set(bearer(client.id, 'USER'))

    expect(res.status).toBe(200)
    expect(res.body.data.booking.status).toBe('CANCELLED')
    expect(res.body.data.booking.meeting.status).toBe('CANCELLED')
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
  })

  it('still cancels the booking when the provider delete fails', async () => {
    const hr = await createConsultant(`${prefix}-cancelfail@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-cancelfail-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slot)
    const bookingId = created.body.data.booking.id
    await ensureMeetingForBooking(bookingId)
    calendarFailureStatus = 500

    await request(app)
      .patch(`/api/v1/bookings/${bookingId}/cancel`)
      .set(bearer(client.id, 'USER'))
      .send({})

    await cancelMeetingForBooking(bookingId)
    const res = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set(bearer(client.id, 'USER'))

    expect(res.status).toBe(200)
    expect(res.body.data.booking.status).toBe('CANCELLED')
    expect(res.body.data.booking.meeting.status).toBe('CANCELLED')
  })

  it('exposes the meeting on booking lists', async () => {
    const hr = await createConsultant(`${prefix}-list@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-list-user@example.com`)
    const [slot] = await fetchSlots(hr.profileId)
    const created = await book(client.id, hr.profileId, slot)
    const bookingId = created.body.data.booking.id
    await ensureMeetingForBooking(bookingId)

    const res = await request(app)
      .get('/api/v1/bookings')
      .query({ scope: 'upcoming' })
      .set(bearer(client.id, 'USER'))

    const entry = res.body.data.find((b: { id: string }) => b.id === bookingId)
    expect(entry.meeting.meetingUrl).toBe(MEET_URL)
  })
})
