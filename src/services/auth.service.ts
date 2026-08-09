import { User, type UserDocument } from '../models/User.js'
import { RefreshToken } from '../models/RefreshToken.js'
import { HRProfile } from '../models/HRProfile.js'
import type { WorkHistoryEntry } from '../models/HRProfile.js'
import { AUTH_LIMITS, PROFILE_STATUS, TOKEN_TYPES, USER_ROLES } from '../config/constants.js'
import type { Currency } from '../config/constants.js'
import { ConflictError, ForbiddenError, UnauthorizedError } from '../utils/http-errors.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import { signAccessToken, signGenericToken, verifyGenericToken } from '../utils/tokens.js'
import { hashRefreshToken, randomRefreshToken } from '../utils/refresh-token.js'
import { sendEmail } from './email/index.js'
import { buildResetPasswordEmail, buildVerifyEmail } from './email/templates/auth.templates.js'
import { assertActiveSpecializations } from './specialization.service.js'
import { logger } from '../config/logger.js'

export interface RegisterInput {
  email: string
  firstName: string
  lastName: string
  password: string
}

export interface RegisterHrInput {
  email: string
  firstName: string
  lastName: string
  password: string
  phone: string
  profileImageUrl?: string
  headline: string
  bio: string
  specializations: string[]
  yearsOfExperience: number
  companyName: string
  hourlyRateCents: number
  currency: Currency
  languages: string[]
  city?: string
  country?: string
  workHistory: WorkHistoryEntry[]
}

export interface LoginInput {
  email: string
  password: string
}

export interface DeviceContext {
  ip?: string
  userAgent?: string
}

export interface AuthResult {
  user: UserDocument
  accessToken: string
  refreshToken: string
}

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function register(input: RegisterInput): Promise<UserDocument> {
  const existing = await User.findOne({ email: input.email.toLowerCase() })
  if (existing) {
    throw new ConflictError('An account with this email already exists.', {
      code: 'EMAIL_ALREADY_REGISTERED',
    })
  }

  const passwordHash = await hashPassword(input.password)
  const user = await User.create({
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    password: passwordHash,
    role: USER_ROLES.USER,
  })

  const token = signGenericToken(user.id, TOKEN_TYPES.VERIFY_EMAIL)
  await sendEmail({
    to: user.email,
    ...buildVerifyEmail({ firstName: user.firstName, token }),
  })

  logger.info({ userId: user.id, email: user.email }, 'User registered')
  return user
}

/**
 * Creates an HR consultant account directly — role is HR from creation, it never passes through
 * USER. Pairs a User and a DRAFT HRProfile in one call. No multi-document transaction (the dev
 * MongoDB runs standalone, matching the rest of this codebase's convention); a failure between
 * the two creates is an accepted risk here, same as elsewhere in the project.
 */
export async function registerHr(input: RegisterHrInput): Promise<UserDocument> {
  const existing = await User.findOne({ email: input.email.toLowerCase() })
  if (existing) {
    throw new ConflictError('An account with this email already exists.', {
      code: 'EMAIL_ALREADY_REGISTERED',
    })
  }

  await assertActiveSpecializations(input.specializations)

  const passwordHash = await hashPassword(input.password)
  const user = await User.create({
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    password: passwordHash,
    phone: input.phone,
    profileImageUrl: input.profileImageUrl,
    role: USER_ROLES.HR,
    // HR accounts skip the self-service email-click verification a plain USER goes through —
    // the meaningful verification for a consultant is an admin reviewing their application
    // (submit-for-review -> approve/reject), not confirming they own an inbox.
    isEmailVerified: true,
    emailVerifiedAt: new Date(),
  })

  try {
    await HRProfile.create({
      userId: user._id,
      headline: input.headline,
      bio: input.bio,
      specializations: input.specializations,
      yearsOfExperience: input.yearsOfExperience,
      companyName: input.companyName,
      hourlyRateCents: input.hourlyRateCents,
      currency: input.currency,
      languages: input.languages,
      city: input.city,
      country: input.country,
      profileImageUrl: input.profileImageUrl,
      workHistory: input.workHistory,
      status: PROFILE_STATUS.DRAFT,
    })
  } catch (err) {
    // No multi-document transaction (standalone dev MongoDB) — if the profile create fails after
    // the account was already created, delete the account rather than strand it as HR with no
    // profile. Same failure mode as upsertProfile(), confirmed to actually happen in practice.
    await User.deleteOne({ _id: user._id }).catch((rollbackErr: unknown) => {
      logger.error(
        {
          userId: user.id,
          err: rollbackErr instanceof Error ? rollbackErr.message : rollbackErr,
        },
        'Failed to roll back orphaned user after HR profile creation failed',
      )
    })
    throw err
  }

  logger.info({ userId: user.id, email: user.email }, 'HR consultant registered')
  return user
}

export async function login(input: LoginInput, device: DeviceContext): Promise<AuthResult> {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+password')
  if (!user) {
    await simulateFailedLogin()
    throw new UnauthorizedError('Invalid email or password.')
  }

  if (user.status !== 'ACTIVE') {
    throw new ForbiddenError('This account has been suspended.', { code: 'ACCOUNT_SUSPENDED' })
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new UnauthorizedError('Too many failed attempts. Try again later.', {
      code: 'ACCOUNT_LOCKED',
    })
  }

  const valid = await verifyPassword(input.password, user.password)
  if (!valid) {
    await incrementFailedAttempts(user)
    throw new UnauthorizedError('Invalid email or password.')
  }

  await resetFailedAttempts(user)

  if (!user.isEmailVerified) {
    const token = signGenericToken(user.id, TOKEN_TYPES.VERIFY_EMAIL)
    await sendEmail({
      to: user.email,
      ...buildVerifyEmail({ firstName: user.firstName, token }),
    })
    throw new UnauthorizedError('Please verify your email address before logging in.', {
      code: 'EMAIL_NOT_VERIFIED',
    })
  }

  const tokens = await issueTokens(user, device)
  logger.info({ userId: user.id }, 'User logged in')
  return tokens
}

export async function refresh(
  refreshToken: string | undefined,
  device: DeviceContext,
): Promise<AuthResult> {
  if (!refreshToken) {
    throw new UnauthorizedError('Missing refresh token.')
  }

  const tokenHash = hashRefreshToken(refreshToken)
  const stored = await RefreshToken.findOne({ tokenHash })
  if (!stored || stored.revokedAt) {
    throw new UnauthorizedError('Invalid or revoked refresh token.')
  }

  if (stored.expiresAt < new Date()) {
    await RefreshToken.deleteOne({ _id: stored._id })
    throw new UnauthorizedError('Refresh token has expired.')
  }

  const user = await User.findById(stored.userId)
  if (!user || user.status !== 'ACTIVE') {
    throw new UnauthorizedError('Account no longer active.')
  }

  const tokens = await issueTokens(user, device, stored)
  logger.info({ userId: user.id }, 'Refresh token rotated')
  return tokens
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken)
    await RefreshToken.deleteOne({ tokenHash })
  }
  logger.info('User logged out')
}

export async function verifyEmail(token: string): Promise<UserDocument> {
  let payload: { sub: string }
  try {
    payload = verifyGenericToken(token, TOKEN_TYPES.VERIFY_EMAIL)
  } catch {
    throw new UnauthorizedError('The verification link is invalid or has expired.', {
      code: 'INVALID_TOKEN',
    })
  }

  const user = await User.findById(payload.sub)
  if (!user) {
    throw new UnauthorizedError('The verification link is invalid or has expired.', {
      code: 'INVALID_TOKEN',
    })
  }

  if (!user.isEmailVerified) {
    user.isEmailVerified = true
    user.emailVerifiedAt = new Date()
    await user.save()
  }

  logger.info({ userId: user.id }, 'Email verified')
  return user
}

export async function forgotPassword(email: string): Promise<void> {
  const user = await User.findOne({ email: email.toLowerCase() })
  if (!user) {
    return
  }

  const token = signGenericToken(user.id, TOKEN_TYPES.RESET_PASSWORD)
  await sendEmail({
    to: user.email,
    ...buildResetPasswordEmail({ firstName: user.firstName, token }),
  })
  logger.info({ userId: user.id }, 'Password reset requested')
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  let payload: { sub: string }
  try {
    payload = verifyGenericToken(token, TOKEN_TYPES.RESET_PASSWORD)
  } catch {
    throw new UnauthorizedError('The reset link is invalid or has expired.', {
      code: 'INVALID_TOKEN',
    })
  }

  const user = await User.findById(payload.sub)
  if (!user) {
    throw new UnauthorizedError('The reset link is invalid or has expired.', {
      code: 'INVALID_TOKEN',
    })
  }

  user.password = await hashPassword(newPassword)
  await user.save()

  await RefreshToken.deleteMany({ userId: user._id })
  logger.info({ userId: user.id }, 'Password reset completed')
}

export async function getUserById(userId: string): Promise<UserDocument> {
  const user = await User.findById(userId)
  if (!user) {
    throw new UnauthorizedError('Account not found.')
  }
  return user
}

export function toPublicUser(user: UserDocument): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    isEmailVerified: user.isEmailVerified,
    phone: user.phone ?? undefined,
    profileImageUrl: user.profileImageUrl ?? undefined,
    createdAt: user.createdAt,
  }
}

async function issueTokens(
  user: UserDocument,
  device: DeviceContext,
  previous?: InstanceType<typeof RefreshToken>,
): Promise<AuthResult> {
  const accessToken = signAccessToken(user.id, user.role)
  const rawRefreshToken = randomRefreshToken()
  const tokenHash = hashRefreshToken(rawRefreshToken)

  await RefreshToken.create({
    userId: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    replacedByTokenHash: undefined,
    userAgent: device.userAgent,
    ip: device.ip,
  })

  if (previous) {
    previous.revokedAt = new Date()
    previous.replacedByTokenHash = tokenHash
    await previous.save()
  }

  return { user, accessToken, refreshToken: rawRefreshToken }
}

async function incrementFailedAttempts(user: UserDocument): Promise<void> {
  user.failedLoginAttempts += 1
  if (user.failedLoginAttempts >= AUTH_LIMITS.MAX_FAILED_ATTEMPTS) {
    user.lockedUntil = new Date(Date.now() + AUTH_LIMITS.LOCKOUT_MS)
    user.failedLoginAttempts = 0
  }
  await user.save()
}

async function resetFailedAttempts(user: UserDocument): Promise<void> {
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    user.failedLoginAttempts = 0
    user.lockedUntil = undefined
    await user.save()
  }
}

async function simulateFailedLogin(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150))
}
