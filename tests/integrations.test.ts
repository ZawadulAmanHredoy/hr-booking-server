import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { connectDatabase, disconnectDatabase } from '../src/config/database.js'
import { connectRedis, disconnectRedis } from '../src/config/redis.js'
import { OAUTH_PROVIDERS, TOKEN_TYPES, USER_ROLES, type UserRole } from '../src/config/constants.js'
import { signAccessToken, signGenericToken } from '../src/utils/tokens.js'
import { encryptSecret } from '../src/utils/crypto.js'
import { User } from '../src/models/User.js'
import { OAuthAccount } from '../src/models/OAuthAccount.js'

const app = createApp()

const prefix = `integration-test-${randomUUID().slice(0, 8)}`

function bearer(userId: string, role: string): { Authorization: string } {
  return { Authorization: `Bearer ${signAccessToken(userId, role)}` }
}

async function createUser(role: UserRole, email: string) {
  return User.create({
    email,
    password: 'not-used-in-tests',
    firstName: 'Integration',
    lastName: 'Tester',
    role,
    isEmailVerified: true,
  })
}

async function cleanup(): Promise<void> {
  const users = await User.find({ email: { $regex: `^${prefix}` } }).select('_id')
  const ids = users.map((user) => user._id)
  await OAuthAccount.deleteMany({ userId: { $in: ids } })
  await User.deleteMany({ email: { $regex: `^${prefix}` } })
}

beforeAll(async () => {
  // Nothing here should reach Google; token revocation is the only outbound call.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  )
  await connectDatabase().catch((err) => {
    console.warn(`MongoDB not reachable for integration tests: ${err.message}`)
  })
  await connectRedis().catch(() => undefined)
  await OAuthAccount.syncIndexes()
  await cleanup()
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await cleanup()
  await disconnectDatabase().catch(() => undefined)
  disconnectRedis()
})

describe('GET /api/v1/integrations', () => {
  it('reports a disconnected consultant', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-none@example.com`)

    const res = await request(app).get('/api/v1/integrations').set(bearer(hr.id, 'HR'))

    expect(res.status).toBe(200)
    expect(res.body.data.google.connected).toBe(false)
    expect(res.body.data.google.configured).toBe(true)
  })

  it('reports a connected consultant without leaking tokens', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-linked@example.com`)
    await OAuthAccount.create({
      userId: hr.id,
      provider: OAUTH_PROVIDERS.GOOGLE,
      providerAccountId: 'google-user-1',
      accountEmail: 'consultant@gmail.com',
      refreshToken: encryptSecret('refresh-token-value'),
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    })

    const res = await request(app).get('/api/v1/integrations').set(bearer(hr.id, 'HR'))

    expect(res.status).toBe(200)
    expect(res.body.data.google.connected).toBe(true)
    expect(res.body.data.google.accountEmail).toBe('consultant@gmail.com')
    expect(JSON.stringify(res.body)).not.toContain('refresh-token-value')
    expect(JSON.stringify(res.body)).not.toContain('refreshToken')
  })

  it('forbids non-HR accounts', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-user@example.com`)

    const res = await request(app).get('/api/v1/integrations').set(bearer(user.id, 'USER'))

    expect(res.status).toBe(403)
  })

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/integrations')

    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/integrations/google/connect', () => {
  it('returns a consent URL carrying a signed state', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-connect@example.com`)

    const res = await request(app)
      .get('/api/v1/integrations/google/connect')
      .set(bearer(hr.id, 'HR'))

    expect(res.status).toBe(200)
    const url = new URL(res.body.data.url)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toContain('calendar.events')
    expect(url.searchParams.get('state')).toBeTruthy()
    // The client secret must never travel to the browser.
    expect(res.body.data.url).not.toContain('test-google-client-secret')
  })

  it('forbids non-HR accounts', async () => {
    const user = await createUser(USER_ROLES.USER, `${prefix}-connect-user@example.com`)

    const res = await request(app)
      .get('/api/v1/integrations/google/connect')
      .set(bearer(user.id, 'USER'))

    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/integrations/google/callback', () => {
  it('redirects back to the app when the state is invalid', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/google/callback')
      .query({ code: 'auth-code', state: 'not-a-real-state' })

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('/profile/integrations')
    expect(res.headers.location).toContain('status=error')
    expect(res.headers.location).toContain('reason=invalid_state')
  })

  it('redirects when Google reports a denial', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/google/callback')
      .query({ error: 'access_denied' })

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('reason=access_denied')
  })

  it('redirects when the code is missing', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-nocode@example.com`)

    const res = await request(app)
      .get('/api/v1/integrations/google/callback')
      .query({ state: signGenericToken(hr.id, TOKEN_TYPES.OAUTH_STATE) })

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('reason=missing_parameters')
  })

  it('does not require a session cookie', async () => {
    const res = await request(app).get('/api/v1/integrations/google/callback').query({})

    expect(res.status).toBe(302)
  })
})

describe('DELETE /api/v1/integrations/google', () => {
  it('404s when nothing is connected', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-nodisconnect@example.com`)

    const res = await request(app).delete('/api/v1/integrations/google').set(bearer(hr.id, 'HR'))

    expect(res.status).toBe(404)
  })

  it('removes the stored connection', async () => {
    const hr = await createUser(USER_ROLES.HR, `${prefix}-disconnect@example.com`)
    await OAuthAccount.create({
      userId: hr.id,
      provider: OAUTH_PROVIDERS.GOOGLE,
      providerAccountId: 'google-user-2',
      refreshToken: encryptSecret('refresh-token-value'),
    })

    const res = await request(app).delete('/api/v1/integrations/google').set(bearer(hr.id, 'HR'))

    expect(res.status).toBe(200)
    expect(res.body.data.google.connected).toBe(false)
    expect(await OAuthAccount.countDocuments({ userId: hr._id })).toBe(0)
  })
})
