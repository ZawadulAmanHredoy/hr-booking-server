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
import { Booking } from '../src/models/Booking.js'
import { AuditLog } from '../src/models/AuditLog.js'
import { Report } from '../src/models/Report.js'
import { Specialization } from '../src/models/Specialization.js'

const app = createApp()

const prefix = `admin-test-${randomUUID().slice(0, 8)}`
const specSlugPrefix = prefix.toUpperCase().replace(/-/g, '_')

const profilePayload = {
  headline: 'Senior HR Business Partner',
  bio: 'I help companies build high-performing teams with 10+ years of HR leadership experience.',
  specializations: ['RECRUITMENT', 'EMPLOYEE_RELATIONS'],
  yearsOfExperience: 10,
  hourlyRateCents: 7500,
  currency: 'USD',
  languages: ['English'],
  city: 'Dhaka',
  country: 'Bangladesh',
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
    firstName: 'Admin',
    lastName: 'Tester',
    role,
    isEmailVerified: true,
  })
}

/** Onboards + submits an HR profile for review, returning its id (still PENDING_REVIEW). */
async function submitProfile(userId: string): Promise<string> {
  await request(app).put('/api/v1/profiles/me').set(bearer(userId, 'HR')).send(profilePayload)
  const submit = await request(app).patch('/api/v1/profiles/me/submit').set(bearer(userId, 'HR'))
  return submit.body.data.profile.id as string
}

async function cleanup(): Promise<void> {
  const users = await User.find({ email: { $regex: `^${prefix}` } }).select('_id')
  const ids = users.map((u) => u._id)
  await Booking.deleteMany({ $or: [{ userId: { $in: ids } }, { hrUserId: { $in: ids } }] })
  await Availability.deleteMany({ hrUserId: { $in: ids } })
  await HRProfile.deleteMany({ userId: { $in: ids } })
  await AuditLog.deleteMany({ actorId: { $in: ids } })
  await Report.deleteMany({ $or: [{ reporterId: { $in: ids } }, { hrUserId: { $in: ids } }] })
  await Specialization.deleteMany({ slug: { $regex: `^${specSlugPrefix}` } })
  await User.deleteMany({ email: { $regex: `^${prefix}` } })
}

beforeAll(async () => {
  await connectDatabase().catch((err) => {
    console.warn(`MongoDB not reachable for admin tests: ${err.message}`)
  })
  await connectRedis().catch(() => undefined)
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await disconnectDatabase().catch(() => undefined)
  disconnectRedis()
})

describe('Admin dashboard', () => {
  it('returns aggregate stats to an admin', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-dash-admin@example.com`)

    const res = await request(app).get('/api/v1/admin/dashboard').set(bearer(admin.id, 'ADMIN'))

    expect(res.status).toBe(200)
    expect(typeof res.body.data.stats.totalUsers).toBe('number')
    expect(typeof res.body.data.stats.pendingHrApplications).toBe('number')
    expect(typeof res.body.data.stats.totalBookings).toBe('number')
  })

  it('forbids non-admin accounts', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-dash-user@example.com`)

    const res = await request(app).get('/api/v1/admin/dashboard').set(bearer(user.id, 'USER'))

    expect(res.status).toBe(403)
  })

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard')
    expect(res.status).toBe(401)
  })

  it('reports read-only platform settings', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-settings-admin@example.com`)

    const res = await request(app).get('/api/v1/admin/settings').set(bearer(admin.id, 'ADMIN'))

    expect(res.status).toBe(200)
    expect(res.body.data.settings.environment).toBe('test')
    expect(typeof res.body.data.settings.googleIntegrationConfigured).toBe('boolean')
  })
})

describe('Admin user management', () => {
  it('lists and filters users', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-list-admin@example.com`)
    await createUser(USER_ROLES.USER, `${prefix}-list-target@example.com`)

    const res = await request(app)
      .get('/api/v1/admin/users')
      .set(bearer(admin.id, 'ADMIN'))
      .query({ role: 'USER', search: `${prefix}-list-target` })

    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data.every((u: { role: string }) => u.role === 'USER')).toBe(true)
  })

  it('returns a user detail', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-detail-admin@example.com`)
    const target = await createUser(USER_ROLES.USER, `${prefix}-detail-target@example.com`)

    const res = await request(app)
      .get(`/api/v1/admin/users/${target.id}`)
      .set(bearer(admin.id, 'ADMIN'))

    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe(target.email)
  })

  it('suspends and reactivates a user', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-suspend-admin@example.com`)
    const target = await createUser(USER_ROLES.USER, `${prefix}-suspend-target@example.com`)

    const suspend = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/suspend`)
      .set(bearer(admin.id, 'ADMIN'))
      .send({ reason: 'Policy violation' })

    expect(suspend.status).toBe(200)
    expect(suspend.body.data.user.status).toBe('SUSPENDED')

    const suspendedLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: target.email, password: 'anything-not-checked' })
    expect(suspendedLogin.status).toBe(403)

    const reactivate = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/reactivate`)
      .set(bearer(admin.id, 'ADMIN'))

    expect(reactivate.status).toBe(200)
    expect(reactivate.body.data.user.status).toBe('ACTIVE')

    const log = await AuditLog.findOne({ actorId: admin.id, action: 'USER_SUSPENDED' })
    expect(log).not.toBeNull()
  })

  it('refuses to suspend an admin account', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-suspend-self-admin@example.com`)
    const otherAdmin = await createUser(
      USER_ROLES.ADMIN,
      `${prefix}-suspend-other-admin@example.com`,
    )

    const res = await request(app)
      .patch(`/api/v1/admin/users/${otherAdmin.id}/suspend`)
      .set(bearer(admin.id, 'ADMIN'))
      .send({ reason: 'Testing the admin-target refusal' })

    expect(res.status).toBe(400)
  })

  it('rejects a suspend request with no reason', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-no-reason-admin@example.com`)
    const target = await createUser(USER_ROLES.USER, `${prefix}-no-reason-target@example.com`)

    const res = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/suspend`)
      .set(bearer(admin.id, 'ADMIN'))
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects re-suspending an already-suspended account', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-double-suspend-admin@example.com`)
    const target = await createUser(USER_ROLES.USER, `${prefix}-double-suspend-target@example.com`)
    await request(app)
      .patch(`/api/v1/admin/users/${target.id}/suspend`)
      .set(bearer(admin.id, 'ADMIN'))
      .send({ reason: 'First suspension' })

    const res = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/suspend`)
      .set(bearer(admin.id, 'ADMIN'))
      .send({ reason: 'Second attempt' })

    expect(res.status).toBe(409)
  })
})

describe('Admin delete user', () => {
  it('deletes a plain user account', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-delete-admin@example.com`)
    const target = await createUser(USER_ROLES.USER, `${prefix}-delete-target@example.com`)

    const res = await request(app)
      .delete(`/api/v1/admin/users/${target.id}`)
      .set(bearer(admin.id, 'ADMIN'))

    expect(res.status).toBe(200)
    expect(await User.findById(target.id)).toBeNull()

    const log = await AuditLog.findOne({ action: 'USER_DELETED', resourceId: target.id })
    expect(log).not.toBeNull()
  })

  it('cascades bookings, meetings, and the HR profile when deleting an HR account', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-delete-hr-admin@example.com`)
    const hr = await createUser(USER_ROLES.HR, `${prefix}-delete-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-delete-hr-client@example.com`)

    await request(app).put('/api/v1/profiles/me').set(bearer(hr.id, 'HR')).send(profilePayload)
    const submit = await request(app).patch('/api/v1/profiles/me/submit').set(bearer(hr.id, 'HR'))
    const profileId = submit.body.data.profile.id as string
    await HRProfile.findByIdAndUpdate(profileId, { status: 'PUBLISHED' })
    await request(app)
      .put('/api/v1/availability/me')
      .set(bearer(hr.id, 'HR'))
      .send(availabilityPayload)

    const slots = await request(app)
      .get(`/api/v1/availability/${profileId}/slots`)
      .query({ from: daysFromNow(3).toISOString(), to: daysFromNow(10).toISOString() })
    const startAt = slots.body.data.slots[0].startAt as string
    const created = await request(app)
      .post('/api/v1/bookings')
      .set(bearer(client.id, 'USER'))
      .send({ profileId, startAt, timezone: 'UTC' })
    expect(created.status).toBe(201)
    const bookingId = created.body.data.booking.id as string

    const res = await request(app)
      .delete(`/api/v1/admin/users/${hr.id}`)
      .set(bearer(admin.id, 'ADMIN'))

    expect(res.status).toBe(200)
    expect(await User.findById(hr.id)).toBeNull()
    expect(await HRProfile.findById(profileId)).toBeNull()
    expect(await Booking.findById(bookingId)).toBeNull()
    expect(await Availability.findOne({ hrUserId: hr.id })).toBeNull()
  })

  it('refuses to delete an admin account', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-delete-self-admin@example.com`)
    const otherAdmin = await createUser(
      USER_ROLES.ADMIN,
      `${prefix}-delete-other-admin@example.com`,
    )

    const res = await request(app)
      .delete(`/api/v1/admin/users/${otherAdmin.id}`)
      .set(bearer(admin.id, 'ADMIN'))

    expect(res.status).toBe(400)
    expect(await User.findById(otherAdmin.id)).not.toBeNull()
  })

  it('returns 404 for an unknown user', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-delete-404-admin@example.com`)

    const res = await request(app)
      .delete('/api/v1/admin/users/64b000000000000000000000')
      .set(bearer(admin.id, 'ADMIN'))

    expect(res.status).toBe(404)
  })

  it('forbids non-admin accounts', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-delete-forbidden@example.com`)
    const target = await createUser(
      USER_ROLES.USER,
      `${prefix}-delete-forbidden-target@example.com`,
    )

    const res = await request(app)
      .delete(`/api/v1/admin/users/${target.id}`)
      .set(bearer(user.id, 'USER'))

    expect(res.status).toBe(403)
  })
})

describe('Admin HR profile review', () => {
  it('lists pending applications and approves one', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-approve-admin@example.com`)
    const hr = await createUser(USER_ROLES.HR, `${prefix}-approve-hr@example.com`)
    const profileId = await submitProfile(hr.id)

    const pending = await request(app)
      .get('/api/v1/admin/hr-profiles')
      .set(bearer(admin.id, 'ADMIN'))
      .query({ status: 'PENDING_REVIEW' })
    expect(pending.status).toBe(200)
    expect(pending.body.data.map((p: { id: string }) => p.id)).toContain(profileId)

    const approve = await request(app)
      .patch(`/api/v1/admin/hr-profiles/${profileId}/approve`)
      .set(bearer(admin.id, 'ADMIN'))
    expect(approve.status).toBe(200)
    expect(approve.body.data.profile.status).toBe('PUBLISHED')

    const publicList = await request(app).get('/api/v1/profiles')
    expect(publicList.body.data.map((p: { id: string }) => p.id)).toContain(profileId)

    const log = await AuditLog.findOne({ action: 'HR_PROFILE_APPROVED', resourceId: profileId })
    expect(log).not.toBeNull()
  })

  it('rejects a pending application with a reason', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-reject-admin@example.com`)
    const hr = await createUser(USER_ROLES.HR, `${prefix}-reject-hr@example.com`)
    const profileId = await submitProfile(hr.id)

    const reject = await request(app)
      .patch(`/api/v1/admin/hr-profiles/${profileId}/reject`)
      .set(bearer(admin.id, 'ADMIN'))
      .send({ reason: 'Bio needs more detail about credentials.' })

    expect(reject.status).toBe(200)
    expect(reject.body.data.profile.status).toBe('REJECTED')
    expect(reject.body.data.profile.rejectionReason).toContain('Bio needs more detail')

    const own = await request(app).get('/api/v1/profiles/me').set(bearer(hr.id, 'HR'))
    expect(own.body.data.profile.status).toBe('REJECTED')
    expect(own.body.data.profile.rejectionReason).toBeDefined()
  })

  it('refuses to approve a profile that is not pending review', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-approve-conflict-admin@example.com`)
    const hr = await createUser(USER_ROLES.HR, `${prefix}-approve-conflict-hr@example.com`)
    await request(app).put('/api/v1/profiles/me').set(bearer(hr.id, 'HR')).send(profilePayload)
    const profile = await HRProfile.findOne({ userId: hr.id })

    const res = await request(app)
      .patch(`/api/v1/admin/hr-profiles/${profile!.id}/approve`)
      .set(bearer(admin.id, 'ADMIN'))

    expect(res.status).toBe(409)
  })

  it('forbids non-admin accounts from reviewing profiles', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-review-forbidden-hr@example.com`)
    const profileId = await submitProfile(hr.id)

    const res = await request(app)
      .patch(`/api/v1/admin/hr-profiles/${profileId}/approve`)
      .set(bearer(hr.id, 'HR'))

    expect(res.status).toBe(403)
  })
})

describe('Admin booking listing', () => {
  it('lists bookings across the platform', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-booking-admin@example.com`)
    const hr = await createUser(USER_ROLES.HR, `${prefix}-booking-hr@example.com`)
    const client = await createUser(USER_ROLES.USER, `${prefix}-booking-client@example.com`)

    await request(app).put('/api/v1/profiles/me').set(bearer(hr.id, 'HR')).send(profilePayload)
    const submit = await request(app).patch('/api/v1/profiles/me/submit').set(bearer(hr.id, 'HR'))
    const profileId = submit.body.data.profile.id as string
    await HRProfile.findByIdAndUpdate(profileId, { status: 'PUBLISHED' })
    await request(app)
      .put('/api/v1/availability/me')
      .set(bearer(hr.id, 'HR'))
      .send(availabilityPayload)

    const slots = await request(app)
      .get(`/api/v1/availability/${profileId}/slots`)
      .query({ from: daysFromNow(3).toISOString(), to: daysFromNow(10).toISOString() })
    const startAt = slots.body.data.slots[0].startAt as string

    const created = await request(app)
      .post('/api/v1/bookings')
      .set(bearer(client.id, 'USER'))
      .send({ profileId, startAt, timezone: 'UTC' })
    expect(created.status).toBe(201)

    const res = await request(app)
      .get('/api/v1/admin/bookings')
      .set(bearer(admin.id, 'ADMIN'))
      .query({ hrUserId: hr.id })

    expect(res.status).toBe(200)
    expect(res.body.data.some((b: { id: string }) => b.id === created.body.data.booking.id)).toBe(
      true,
    )
  })

  it('forbids non-admin accounts', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-booking-forbidden@example.com`)
    const res = await request(app).get('/api/v1/admin/bookings').set(bearer(user.id, 'USER'))
    expect(res.status).toBe(403)
  })
})

describe('Specializations', () => {
  it('lists only active specializations publicly', async () => {
    const res = await request(app).get('/api/v1/specializations')

    expect(res.status).toBe(200)
    expect(res.body.data.specializations.length).toBeGreaterThan(0)
    expect(res.body.data.specializations.every((s: { isActive: boolean }) => s.isActive)).toBe(true)
  })

  it('lets an admin create, update, deactivate and delete one', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-spec-admin@example.com`)
    const slug = `${specSlugPrefix}_ONE`

    const create = await request(app)
      .post('/api/v1/admin/specializations')
      .set(bearer(admin.id, 'ADMIN'))
      .send({ slug, name: 'Admin Test Specialization' })
    expect(create.status).toBe(201)
    const id = create.body.data.specialization.id as string

    const publicList = await request(app).get('/api/v1/specializations')
    expect(publicList.body.data.specializations.map((s: { slug: string }) => s.slug)).toContain(
      slug,
    )

    const update = await request(app)
      .patch(`/api/v1/admin/specializations/${id}`)
      .set(bearer(admin.id, 'ADMIN'))
      .send({ isActive: false })
    expect(update.status).toBe(200)
    expect(update.body.data.specialization.isActive).toBe(false)

    const afterDeactivate = await request(app).get('/api/v1/specializations')
    expect(
      afterDeactivate.body.data.specializations.map((s: { slug: string }) => s.slug),
    ).not.toContain(slug)

    const del = await request(app)
      .delete(`/api/v1/admin/specializations/${id}`)
      .set(bearer(admin.id, 'ADMIN'))
    expect(del.status).toBe(200)
  })

  it('refuses to delete a specialization still used by a profile', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-spec-inuse-admin@example.com`)
    const hr = await createUser(USER_ROLES.HR, `${prefix}-spec-inuse-hr@example.com`)
    const slug = `${specSlugPrefix}_INUSE`
    const create = await request(app)
      .post('/api/v1/admin/specializations')
      .set(bearer(admin.id, 'ADMIN'))
      .send({ slug, name: 'In-use Specialization' })
    const id = create.body.data.specialization.id as string

    await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(hr.id, 'HR'))
      .send({ ...profilePayload, specializations: [slug] })

    const del = await request(app)
      .delete(`/api/v1/admin/specializations/${id}`)
      .set(bearer(admin.id, 'ADMIN'))

    expect(del.status).toBe(409)
  })

  it('rejects an unknown specialization on the profile form', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-spec-unknown-hr@example.com`)

    const res = await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(hr.id, 'HR'))
      .send({ ...profilePayload, specializations: ['NOT_A_REAL_SPECIALIZATION'] })

    expect(res.status).toBe(400)
  })

  it('forbids non-admin accounts from managing specializations', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-spec-forbidden@example.com`)
    const res = await request(app)
      .post('/api/v1/admin/specializations')
      .set(bearer(user.id, 'USER'))
      .send({ slug: `${specSlugPrefix}_FORBIDDEN`, name: 'Nope' })
    expect(res.status).toBe(403)
  })
})

describe('Reports', () => {
  it('lets an authenticated user report a profile and an admin resolve it', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-report-admin@example.com`)
    const hr = await createUser(USER_ROLES.HR, `${prefix}-report-hr@example.com`)
    const reporter = await createUser(USER_ROLES.USER, `${prefix}-report-reporter@example.com`)
    const profileId = await submitProfile(hr.id)
    await HRProfile.findByIdAndUpdate(profileId, { status: 'PUBLISHED' })

    const create = await request(app)
      .post('/api/v1/reports')
      .set(bearer(reporter.id, 'USER'))
      .send({ hrProfileId: profileId, reason: 'MISLEADING_INFO', details: 'Claims are inflated.' })
    expect(create.status).toBe(201)
    expect(create.body.data.report.status).toBe('PENDING')

    const duplicate = await request(app)
      .post('/api/v1/reports')
      .set(bearer(reporter.id, 'USER'))
      .send({ hrProfileId: profileId, reason: 'SPAM' })
    expect(duplicate.status).toBe(409)

    const list = await request(app)
      .get('/api/v1/admin/reports')
      .set(bearer(admin.id, 'ADMIN'))
      .query({ status: 'PENDING' })
    expect(list.status).toBe(200)
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(create.body.data.report.id)

    const resolve = await request(app)
      .patch(`/api/v1/admin/reports/${create.body.data.report.id}/resolve`)
      .set(bearer(admin.id, 'ADMIN'))
      .send({ status: 'DISMISSED', notes: 'No policy violation found.' })
    expect(resolve.status).toBe(200)
    expect(resolve.body.data.report.status).toBe('DISMISSED')

    const resolveAgain = await request(app)
      .patch(`/api/v1/admin/reports/${create.body.data.report.id}/resolve`)
      .set(bearer(admin.id, 'ADMIN'))
      .send({ status: 'DISMISSED' })
    expect(resolveAgain.status).toBe(409)
  })

  it('rejects reporting your own profile', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-report-self-hr@example.com`)
    const profileId = await submitProfile(hr.id)
    await HRProfile.findByIdAndUpdate(profileId, { status: 'PUBLISHED' })

    const res = await request(app)
      .post('/api/v1/reports')
      .set(bearer(hr.id, 'HR'))
      .send({ hrProfileId: profileId, reason: 'SPAM' })

    expect(res.status).toBe(400)
  })
})

describe('Audit logs', () => {
  it('lists recorded actions to an admin', async () => {
    const admin = await createUser(USER_ROLES.ADMIN, `${prefix}-audit-admin@example.com`)
    const target = await createUser(USER_ROLES.USER, `${prefix}-audit-target@example.com`)
    await request(app)
      .patch(`/api/v1/admin/users/${target.id}/suspend`)
      .set(bearer(admin.id, 'ADMIN'))
      .send({ reason: 'Testing audit logging' })

    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set(bearer(admin.id, 'ADMIN'))
      .query({ action: 'USER_SUSPENDED', actorId: admin.id })

    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data[0].action).toBe('USER_SUSPENDED')
  })

  it('forbids non-admin accounts', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-audit-forbidden@example.com`)
    const res = await request(app).get('/api/v1/admin/audit-logs').set(bearer(user.id, 'USER'))
    expect(res.status).toBe(403)
  })
})
