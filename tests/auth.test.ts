import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Response } from 'supertest'
import { createApp } from '../src/app.js'
import { connectDatabase, disconnectDatabase } from '../src/config/database.js'
import { connectRedis, disconnectRedis } from '../src/config/redis.js'
import { AUTH_COOKIES, TOKEN_TYPES } from '../src/config/constants.js'
import { signGenericToken } from '../src/utils/tokens.js'
import { hashRefreshToken } from '../src/utils/refresh-token.js'
import { User } from '../src/models/User.js'
import { RefreshToken } from '../src/models/RefreshToken.js'

const app = createApp()

const baseEmail = `auth-test-${randomUUID().slice(0, 8)}`
const registerPayload = {
  email: `${baseEmail}@example.com`,
  password: 'StrongPass123!',
  firstName: 'Auth',
  lastName: 'Tester',
}

function setCookies(res: Response): string[] {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined
  return setCookie ?? []
}

function cookieValue(res: Response, name: string): string | undefined {
  const raw = setCookies(res).find((c) => c.startsWith(`${name}=`))
  if (!raw) return undefined
  return raw.split(';')[0].slice(name.length + 1)
}

async function registerUser(email: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/register').send({
    email,
    password: 'StrongPass123!',
    firstName: 'Auth',
    lastName: 'Tester',
  })
  expect(res.status).toBe(201)
  return res.body.data.user.id as string
}

async function cleanup(): Promise<void> {
  const users = await User.find({ email: { $regex: `^${baseEmail}` } }).select('_id')
  const ids = users.map((user) => user._id)
  await RefreshToken.deleteMany({ userId: { $in: ids } })
  await User.deleteMany({ email: { $regex: `^${baseEmail}` } })
}

beforeAll(async () => {
  await connectDatabase().catch((err) => {
    console.warn(`MongoDB not reachable for auth tests: ${err.message}`)
  })
  await connectRedis().catch(() => undefined)
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await disconnectDatabase().catch(() => undefined)
  disconnectRedis()
})

describe('POST /api/v1/auth/register', () => {
  it('registers a user and returns the public profile', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(registerPayload)

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.user.email).toBe(registerPayload.email)
    expect(res.body.data.user.password).toBeUndefined()
    expect(res.body.data.user.role).toBe('USER')
    expect(res.body.data.user.isEmailVerified).toBe(false)
  })

  it('rejects a duplicate email with 409', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(registerPayload)

    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('rejects invalid payloads with 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'not-an-email',
      password: 'short',
      firstName: 'A',
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('Email verification', () => {
  it('blocks login until the email is verified', async () => {
    const email = `${baseEmail}-unverified@example.com`
    await registerUser(email)

    const res = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'StrongPass123!',
    })

    expect(res.status).toBe(401)
    expect(res.body.error.details?.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('verifies the email with a valid token', async () => {
    const email = `${baseEmail}-verify@example.com`
    const userId = await registerUser(email)
    const token = signGenericToken(userId, TOKEN_TYPES.VERIFY_EMAIL)

    const res = await request(app).post('/api/v1/auth/verify-email').send({ token })

    expect(res.status).toBe(200)
    expect(res.body.data.user.isEmailVerified).toBe(true)
  })

  it('rejects an invalid verification token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'not-a-valid-token' })

    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/auth/login', () => {
  it('logs in and sets httpOnly auth cookies', async () => {
    const email = `${baseEmail}-login@example.com`
    const userId = await registerUser(email)
    const token = signGenericToken(userId, TOKEN_TYPES.VERIFY_EMAIL)
    await request(app).post('/api/v1/auth/verify-email').send({ token })

    const res = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'StrongPass123!',
    })

    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe(email)
    expect(cookieValue(res, AUTH_COOKIES.ACCESS)).toBeDefined()
    expect(cookieValue(res, AUTH_COOKIES.REFRESH)).toBeDefined()
    const accessCookie = setCookies(res).find((c) => c.startsWith(`${AUTH_COOKIES.ACCESS}=`))
    expect(accessCookie).toContain('HttpOnly')
  })

  it('rejects a wrong password', async () => {
    const email = `${baseEmail}-wrongpw@example.com`
    const userId = await registerUser(email)
    const token = signGenericToken(userId, TOKEN_TYPES.VERIFY_EMAIL)
    await request(app).post('/api/v1/auth/verify-email').send({ token })

    const res = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'WrongPass123!',
    })

    expect(res.status).toBe(401)
  })

  it('locks the account after too many failed attempts', async () => {
    const email = `${baseEmail}-lockout@example.com`
    const userId = await registerUser(email)
    const token = signGenericToken(userId, TOKEN_TYPES.VERIFY_EMAIL)
    await request(app).post('/api/v1/auth/verify-email').send({ token })

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).post('/api/v1/auth/login').send({
        email,
        password: 'WrongPass123!',
      })
      expect(res.status).toBe(401)
    }

    const locked = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'StrongPass123!',
    })

    expect(locked.status).toBe(401)
    expect(locked.body.error.details?.code).toBe('ACCOUNT_LOCKED')
  })
})

describe('GET /api/v1/auth/me', () => {
  it('returns the current user via cookie', async () => {
    const email = `${baseEmail}-me@example.com`
    const userId = await registerUser(email)
    const token = signGenericToken(userId, TOKEN_TYPES.VERIFY_EMAIL)
    await request(app).post('/api/v1/auth/verify-email').send({ token })
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'StrongPass123!',
    })

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set(
        'Cookie',
        setCookies(loginRes).map((c) => c.split(';')[0]),
      )

    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe(email)
  })

  it('supports Bearer token authentication', async () => {
    const email = `${baseEmail}-bearer@example.com`
    const userId = await registerUser(email)
    const token = signGenericToken(userId, TOKEN_TYPES.VERIFY_EMAIL)
    await request(app).post('/api/v1/auth/verify-email').send({ token })
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'StrongPass123!',
    })
    const accessToken = cookieValue(loginRes, AUTH_COOKIES.ACCESS)

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe(email)
  })

  it('rejects a missing token with 401', async () => {
    const res = await request(app).get('/api/v1/auth/me')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })
})

describe('Refresh token rotation', () => {
  it('rotates the refresh token on refresh', async () => {
    const email = `${baseEmail}-rotate@example.com`
    const userId = await registerUser(email)
    const token = signGenericToken(userId, TOKEN_TYPES.VERIFY_EMAIL)
    await request(app).post('/api/v1/auth/verify-email').send({ token })
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'StrongPass123!',
    })
    const firstRefresh = cookieValue(loginRes, AUTH_COOKIES.REFRESH)

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${AUTH_COOKIES.REFRESH}=${firstRefresh}`)

    expect(res.status).toBe(200)
    const secondRefresh = cookieValue(res, AUTH_COOKIES.REFRESH)
    expect(secondRefresh).toBeDefined()
    expect(secondRefresh).not.toBe(firstRefresh)

    const stored = await RefreshToken.findOne({
      tokenHash: hashRefreshToken(firstRefresh as string),
    })
    expect(stored?.revokedAt).toBeInstanceOf(Date)
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('clears auth cookies', async () => {
    const email = `${baseEmail}-logout@example.com`
    const userId = await registerUser(email)
    const token = signGenericToken(userId, TOKEN_TYPES.VERIFY_EMAIL)
    await request(app).post('/api/v1/auth/verify-email').send({ token })
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'StrongPass123!',
    })

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set(
        'Cookie',
        setCookies(loginRes).map((c) => c.split(';')[0]),
      )

    expect(res.status).toBe(200)
    const cleared = setCookies(res)
    expect(cleared.some((c) => c.startsWith(`${AUTH_COOKIES.REFRESH}=`))).toBe(true)
  })
})

describe('Password reset', () => {
  it('returns a generic message without leaking account existence', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `${baseEmail}-ghost@example.com` })

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('If an account exists')
  })

  it('resets the password and invalidates old credentials', async () => {
    const email = `${baseEmail}-reset@example.com`
    const userId = await registerUser(email)
    const token = signGenericToken(userId, TOKEN_TYPES.VERIFY_EMAIL)
    await request(app).post('/api/v1/auth/verify-email').send({ token })

    const resetToken = signGenericToken(userId, TOKEN_TYPES.RESET_PASSWORD)
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, password: 'NewStrongPass123!' })

    expect(res.status).toBe(200)

    const oldLogin = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'StrongPass123!',
    })
    expect(oldLogin.status).toBe(401)

    const newLogin = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'NewStrongPass123!',
    })
    expect(newLogin.status).toBe(200)
  })
})
