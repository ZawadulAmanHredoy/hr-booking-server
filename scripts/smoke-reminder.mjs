import request from 'supertest'
import { createApp } from '../src/app.ts'
import { connectDatabase, disconnectDatabase } from '../src/config/database.ts'
import { connectRedis, disconnectRedis } from '../src/config/redis.ts'
import { User } from '../src/models/User.ts'
import { Booking } from '../src/models/Booking.ts'
import { signAccessToken } from '../src/utils/tokens.ts'
import { getReminderQueue } from '../src/queues/reminder.queue.ts'

const app = createApp()
const prefix = `live-smoke-${Math.random().toString(36).slice(2, 8)}`

async function createUser(role, email) {
  return User.create({
    email,
    password: 'not-used-in-tests',
    firstName: 'Live',
    lastName: 'User',
    role,
    isEmailVerified: true,
  })
}

async function createConsultant(email) {
  const hr = await createUser('HR', email)
  await request(app)
    .put('/api/v1/profiles/me')
    .set({ Authorization: `Bearer ${signAccessToken(hr.id, 'HR')}` })
    .send({
      headline: 'Live Consultant',
      bio: 'Smoke test consultant',
      specializations: ['RECRUITMENT'],
      yearsOfExperience: 5,
      hourlyRateCents: 4000,
      currency: 'USD',
      languages: ['English'],
    })

  const publish = await request(app)
    .patch('/api/v1/profiles/me/publish')
    .set({ Authorization: `Bearer ${signAccessToken(hr.id, 'HR')}` })
    .send({ status: 'PUBLISHED' })

  await request(app)
    .put('/api/v1/availability/me')
    .set({ Authorization: `Bearer ${signAccessToken(hr.id, 'HR')}` })
    .send({
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
    })

  return { userId: hr.id, profileId: publish.body.data.profile.id }
}

async function fetchSlots(profileId) {
  const res = await request(app)
    .get(`/api/v1/availability/${profileId}/slots`)
    .query({
      from: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    })
  return res.body.data.slots.map((slot) => slot.startAt)
}

try {
  await connectDatabase()
  await connectRedis()
  await Booking.syncIndexes()

  const consultant = await createConsultant(`${prefix}-hr@example.com`)
  const client = await createUser('USER', `${prefix}-client@example.com`)
  const slots = await fetchSlots(consultant.profileId)
  const res = await request(app)
    .post('/api/v1/bookings')
    .set({ Authorization: `Bearer ${signAccessToken(client.id, 'USER')}` })
    .send({ profileId: consultant.profileId, startAt: slots[0], timezone: 'Asia/Dhaka' })

  console.log(
    JSON.stringify({
      status: res.status,
      bookingId: res.body?.data?.booking?.id,
      error: res.body?.error,
    }),
  )

  await new Promise((resolve) => setTimeout(resolve, 1000))

  const jobs = await getReminderQueue().getJobs(['waiting', 'delayed', 'active'])
  console.log(
    JSON.stringify({
      reminderJobs: jobs.map((job) => ({ id: job.id, name: job.name, data: job.data })),
    }),
  )
} finally {
  await disconnectDatabase().catch(() => undefined)
  disconnectRedis()
}
