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

const app = createApp()

const prefix = `profile-test-${randomUUID().slice(0, 8)}`

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

function bearer(userId: string, role: string): { Authorization: string } {
  return { Authorization: `Bearer ${signAccessToken(userId, role)}` }
}

/**
 * Submits a profile for review and flips it straight to PUBLISHED via the model, bypassing the
 * admin approval HTTP call. The approve/reject endpoints themselves are covered end-to-end in
 * admin.test.ts; the tests in this file only need a published fixture.
 */
async function publishProfile(
  userId: string,
): Promise<{ body: { data: { profile: { id: string } } } }> {
  const submit = await request(app).patch('/api/v1/profiles/me/submit').set(bearer(userId, 'HR'))
  const profileId = submit.body.data.profile.id as string
  await HRProfile.findByIdAndUpdate(profileId, { status: PROFILE_STATUS.PUBLISHED })
  return { body: { data: { profile: { id: profileId } } } }
}

async function createUser(role: UserRole, email: string) {
  const user = await User.create({
    email,
    password: 'not-used-in-tests',
    firstName: 'Profile',
    lastName: 'Tester',
    role,
    isEmailVerified: true,
  })
  return user
}

async function cleanup(): Promise<void> {
  const users = await User.find({ email: { $regex: `^${prefix}` } }).select('_id')
  const ids = users.map((user) => user._id)
  await HRProfile.deleteMany({ userId: { $in: ids } })
  await User.deleteMany({ email: { $regex: `^${prefix}` } })
}

beforeAll(async () => {
  await connectDatabase().catch((err) => {
    console.warn(`MongoDB not reachable for profile tests: ${err.message}`)
  })
  await connectRedis().catch(() => undefined)
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await disconnectDatabase().catch(() => undefined)
  disconnectRedis()
})

describe('PUT /api/v1/profiles/me (onboarding)', () => {
  it('creates a profile and upgrades a USER to HR', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-onboard@example.com`)

    const res = await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(user.id, USER_ROLES.USER))
      .send(profilePayload)

    expect(res.status).toBe(200)
    expect(res.body.data.upgraded).toBe(true)
    expect(res.body.data.profile.status).toBe('DRAFT')
    expect(res.body.data.profile.hourlyRateCents).toBe(7500)

    const updated = await User.findById(user.id)
    expect(updated?.role).toBe(USER_ROLES.HR)
  })

  it('updates an existing profile instead of creating a duplicate', async () => {
    const user = await createUser(USER_ROLES.HR, `${prefix}-update@example.com`)
    await request(app).put('/api/v1/profiles/me').set(bearer(user.id, 'HR')).send(profilePayload)

    const res = await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(user.id, 'HR'))
      .send({ ...profilePayload, headline: 'Lead HR Consultant' })

    expect(res.status).toBe(200)
    expect(res.body.data.upgraded).toBe(false)
    expect(res.body.data.profile.headline).toBe('Lead HR Consultant')
    expect(await HRProfile.countDocuments({ userId: user._id })).toBe(1)
  })

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).put('/api/v1/profiles/me').send(profilePayload)

    expect(res.status).toBe(401)
  })

  it('rejects invalid payloads with 400', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-invalid@example.com`)

    const res = await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(user.id, USER_ROLES.USER))
      .send({ ...profilePayload, specializations: [] })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('Own profile (HR-only)', () => {
  it('returns the own profile', async () => {
    const user = await createUser(USER_ROLES.HR, `${prefix}-me@example.com`)
    await request(app).put('/api/v1/profiles/me').set(bearer(user.id, 'HR')).send(profilePayload)

    const res = await request(app).get('/api/v1/profiles/me').set(bearer(user.id, 'HR'))

    expect(res.status).toBe(200)
    expect(res.body.data.profile.id).toBeDefined()
    expect(res.body.data.profile.status).toBe('DRAFT')
  })

  it('forbids non-HR accounts (requireRole)', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-forbidden@example.com`)

    const res = await request(app).get('/api/v1/profiles/me').set(bearer(user.id, USER_ROLES.USER))

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('toggles availability', async () => {
    const user = await createUser(USER_ROLES.HR, `${prefix}-avail@example.com`)
    await request(app).put('/api/v1/profiles/me').set(bearer(user.id, 'HR')).send(profilePayload)

    const res = await request(app)
      .patch('/api/v1/profiles/me/availability')
      .set(bearer(user.id, 'HR'))
      .send({ isAvailable: false })

    expect(res.status).toBe(200)
    expect(res.body.data.profile.isAvailable).toBe(false)
  })
})

describe('Review workflow (submit / withdraw)', () => {
  it('submits a draft for review', async () => {
    const user = await createUser(USER_ROLES.HR, `${prefix}-submit@example.com`)
    await request(app).put('/api/v1/profiles/me').set(bearer(user.id, 'HR')).send(profilePayload)

    const res = await request(app).patch('/api/v1/profiles/me/submit').set(bearer(user.id, 'HR'))

    expect(res.status).toBe(200)
    expect(res.body.data.profile.status).toBe('PENDING_REVIEW')
  })

  it('rejects submitting a profile that is already pending review', async () => {
    const user = await createUser(USER_ROLES.HR, `${prefix}-submit-twice@example.com`)
    await request(app).put('/api/v1/profiles/me').set(bearer(user.id, 'HR')).send(profilePayload)
    await request(app).patch('/api/v1/profiles/me/submit').set(bearer(user.id, 'HR'))

    const res = await request(app).patch('/api/v1/profiles/me/submit').set(bearer(user.id, 'HR'))

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('withdraws a pending profile back to draft', async () => {
    const user = await createUser(USER_ROLES.HR, `${prefix}-withdraw@example.com`)
    await request(app).put('/api/v1/profiles/me').set(bearer(user.id, 'HR')).send(profilePayload)
    await request(app).patch('/api/v1/profiles/me/submit').set(bearer(user.id, 'HR'))

    const res = await request(app).patch('/api/v1/profiles/me/withdraw').set(bearer(user.id, 'HR'))

    expect(res.status).toBe(200)
    expect(res.body.data.profile.status).toBe('DRAFT')
  })

  it('rejects withdrawing a profile that is still a draft', async () => {
    const user = await createUser(USER_ROLES.HR, `${prefix}-withdraw-draft@example.com`)
    await request(app).put('/api/v1/profiles/me').set(bearer(user.id, 'HR')).send(profilePayload)

    const res = await request(app).patch('/api/v1/profiles/me/withdraw').set(bearer(user.id, 'HR'))

    expect(res.status).toBe(409)
  })

  it('rejects unauthenticated and non-HR requests', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-submit-forbidden@example.com`)

    const noAuth = await request(app).patch('/api/v1/profiles/me/submit')
    expect(noAuth.status).toBe(401)

    const wrongRole = await request(app)
      .patch('/api/v1/profiles/me/submit')
      .set(bearer(user.id, USER_ROLES.USER))
    expect(wrongRole.status).toBe(403)
  })
})

describe('Public listing', () => {
  it('only lists published profiles', async () => {
    const published = await createUser(USER_ROLES.HR, `${prefix}-pub@example.com`)
    const draft = await createUser(USER_ROLES.HR, `${prefix}-draft@example.com`)
    await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(published.id, 'HR'))
      .send(profilePayload)
    await request(app).put('/api/v1/profiles/me').set(bearer(draft.id, 'HR')).send(profilePayload)

    const publishRes = await publishProfile(published.id)

    const list = await request(app).get('/api/v1/profiles')

    expect(list.status).toBe(200)
    const ids = list.body.data.map((p: { id: string }) => p.id)
    expect(ids).toContain(publishRes.body.data.profile.id)
    expect(ids).not.toContain(draft.id)
  })

  it('includes the consultant name on cards', async () => {
    const user = await createUser(USER_ROLES.HR, `${prefix}-named@example.com`)
    await request(app).put('/api/v1/profiles/me').set(bearer(user.id, 'HR')).send(profilePayload)
    await publishProfile(user.id)

    const list = await request(app).get('/api/v1/profiles')

    const entry = list.body.data.find((p: { user: { id: string } }) => p.user.id === user.id)
    expect(entry.user.firstName).toBe('Profile')
    expect(entry.user.lastName).toBe('Tester')
  })

  it('filters by specialization and language', async () => {
    const a = await createUser(USER_ROLES.HR, `${prefix}-spec-a@example.com`)
    const b = await createUser(USER_ROLES.HR, `${prefix}-spec-b@example.com`)
    await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(a.id, 'HR'))
      .send({ ...profilePayload, specializations: ['RECRUITMENT'] })
    await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(b.id, 'HR'))
      .send({ ...profilePayload, specializations: ['HRIS'], languages: ['French'] })
    await publishProfile(a.id)
    await publishProfile(b.id)

    const specRes = await request(app).get('/api/v1/profiles').query({ specialization: 'HRIS' })
    expect(specRes.status).toBe(200)
    expect(specRes.body.data).toHaveLength(1)
    expect(specRes.body.data[0].user.id).toBe(b.id)

    const langRes = await request(app).get('/api/v1/profiles').query({ language: 'French' })
    expect(langRes.body.data).toHaveLength(1)
    expect(langRes.body.data[0].user.id).toBe(b.id)
  })

  it('searches the headline and sorts by hourly rate ascending', async () => {
    const a = await createUser(USER_ROLES.HR, `${prefix}-sort-a@example.com`)
    const b = await createUser(USER_ROLES.HR, `${prefix}-sort-b@example.com`)
    await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(a.id, 'HR'))
      .send({ ...profilePayload, headline: 'Junior Recruiter', hourlyRateCents: 5000 })
    await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(b.id, 'HR'))
      .send({ ...profilePayload, headline: 'Senior Recruiter', hourlyRateCents: 12000 })
    await publishProfile(a.id)
    await publishProfile(b.id)

    const search = await request(app).get('/api/v1/profiles').query({ search: 'Recruiter' })
    expect(search.body.data).toHaveLength(2)

    const sorted = await request(app)
      .get('/api/v1/profiles')
      .query({ search: 'Recruiter', sortBy: 'hourlyRateCents', sortOrder: 'asc' })
    expect(sorted.body.data[0].hourlyRateCents).toBe(5000)
    expect(sorted.body.data[1].hourlyRateCents).toBe(12000)
  })

  it('filters by price range', async () => {
    const a = await createUser(USER_ROLES.HR, `${prefix}-price-a@example.com`)
    const b = await createUser(USER_ROLES.HR, `${prefix}-price-b@example.com`)
    await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(a.id, 'HR'))
      .send({ ...profilePayload, hourlyRateCents: 3000 })
    await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(b.id, 'HR'))
      .send({ ...profilePayload, hourlyRateCents: 9000 })
    await publishProfile(a.id)
    await publishProfile(b.id)

    const res = await request(app)
      .get('/api/v1/profiles')
      .query({ minRateCents: 4000, maxRateCents: 10000 })

    const rates: number[] = res.body.data.map((p: { hourlyRateCents: number }) => p.hourlyRateCents)
    expect(rates.length).toBeGreaterThan(0)
    expect(rates.every((r) => r >= 4000 && r <= 10000)).toBe(true)
    expect(rates).toContain(9000)
    expect(rates).not.toContain(3000)
    const ids = res.body.data.map((p: { user: { id: string } }) => p.user.id)
    expect(ids).toContain(b.id)
    expect(ids).not.toContain(a.id)
  })
})

describe('Public profile detail', () => {
  it('returns a published profile by id', async () => {
    const user = await createUser(USER_ROLES.HR, `${prefix}-detail@example.com`)
    await request(app).put('/api/v1/profiles/me').set(bearer(user.id, 'HR')).send(profilePayload)
    const publish = await publishProfile(user.id)
    const id = publish.body.data.profile.id

    const res = await request(app).get(`/api/v1/profiles/${id}`)

    expect(res.status).toBe(200)
    expect(res.body.data.profile.id).toBe(id)
    expect(res.body.data.profile.user.firstName).toBe('Profile')
  })

  it('hides draft profiles from public access', async () => {
    const user = await createUser(USER_ROLES.HR, `${prefix}-hidden@example.com`)
    const created = await request(app)
      .put('/api/v1/profiles/me')
      .set(bearer(user.id, 'HR'))
      .send(profilePayload)

    const res = await request(app).get(`/api/v1/profiles/${created.body.data.profile.id}`)

    expect(res.status).toBe(404)
  })

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/v1/profiles/64b000000000000000000000')

    expect(res.status).toBe(404)
  })

  it('rejects a malformed id with 400', async () => {
    const res = await request(app).get('/api/v1/profiles/not-an-id')

    expect(res.status).toBe(400)
  })
})
