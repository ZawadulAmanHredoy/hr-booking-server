import { HRProfile, type HRProfileDocument } from '../models/HRProfile.js'
import { User, type UserDocument } from '../models/User.js'
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  PROFILE_STATUS,
  USER_ROLES,
} from '../config/constants.js'
import { ConflictError, NotFoundError } from '../utils/http-errors.js'
import { logger } from '../config/logger.js'
import { assertActiveSpecializations } from './specialization.service.js'
import { recordAuditLog } from './audit-log.service.js'
import { enqueueEmail } from './email/index.js'
import {
  buildProfileApproved,
  buildProfileRejected,
} from './email/templates/hr-profile.templates.js'
import type { Pagination } from '../utils/response.js'
import type { ListProfilesQuery, UpsertProfileInput } from '../validators/hrProfile.validator.js'

export interface Actor {
  id: string
  role: string
}

export interface UpsertProfileResult {
  profile: HRProfileDocument
  upgraded: boolean
}

type PopulatedProfile = HRProfileDocument & { userId: UserDocument }

const PUBLISHED = PROFILE_STATUS.PUBLISHED

export async function upsertProfile(
  userId: string,
  input: UpsertProfileInput,
): Promise<UpsertProfileResult> {
  await assertActiveSpecializations(input.specializations)

  const existing = await HRProfile.findOne({ userId })

  if (existing) {
    Object.assign(existing, input)
    await existing.save()
    return { profile: existing, upgraded: false }
  }

  const user = await User.findById(userId)
  if (!user) {
    throw new NotFoundError('Account not found.')
  }

  const upgraded = user.role !== USER_ROLES.HR
  if (upgraded) {
    user.role = USER_ROLES.HR
    await user.save()
  }

  try {
    const profile = await HRProfile.create({
      userId,
      ...input,
      status: PROFILE_STATUS.DRAFT,
    })

    return { profile, upgraded }
  } catch (err) {
    // The dev MongoDB is standalone (no multi-document transactions), so the role flip above and
    // this create() aren't atomic. Without this, a failure here silently strands the account as
    // HR with no profile — confirmed to actually happen, not just a theoretical risk.
    if (upgraded) {
      user.role = USER_ROLES.USER
      await user.save().catch((rollbackErr: unknown) => {
        logger.error(
          { userId, err: rollbackErr instanceof Error ? rollbackErr.message : rollbackErr },
          'Failed to roll back HR role upgrade after profile creation failed',
        )
      })
    }
    throw err
  }
}

export async function getProfileByUserId(userId: string): Promise<HRProfileDocument> {
  const profile = await HRProfile.findOne({ userId })
  if (!profile) {
    throw new NotFoundError('Profile not found. Complete onboarding to create one.')
  }
  return profile
}

/** HR submits a draft (or a previously rejected profile) for admin review. */
export async function submitProfileForReview(userId: string): Promise<HRProfileDocument> {
  const profile = await HRProfile.findOne({ userId })
  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }
  if (profile.status !== PROFILE_STATUS.DRAFT && profile.status !== PROFILE_STATUS.REJECTED) {
    throw new ConflictError('Only a draft or rejected profile can be submitted for review.')
  }
  profile.status = PROFILE_STATUS.PENDING_REVIEW
  profile.rejectionReason = undefined
  await profile.save()
  return profile
}

/** HR pulls a pending or live profile back to draft — e.g. to pause bookings or make edits. */
export async function withdrawProfile(userId: string): Promise<HRProfileDocument> {
  const profile = await HRProfile.findOne({ userId })
  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }
  if (
    profile.status !== PROFILE_STATUS.PENDING_REVIEW &&
    profile.status !== PROFILE_STATUS.PUBLISHED
  ) {
    throw new ConflictError('This profile cannot be withdrawn from its current state.')
  }
  profile.status = PROFILE_STATUS.DRAFT
  await profile.save()
  return profile
}

/** Admin-only: publishes a profile that is waiting for review. */
export async function approveProfile(actor: Actor, profileId: string): Promise<HRProfileDocument> {
  const profile = await HRProfile.findById(profileId)
  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }
  if (profile.status !== PROFILE_STATUS.PENDING_REVIEW) {
    throw new ConflictError('Only a profile pending review can be approved.')
  }

  profile.status = PROFILE_STATUS.PUBLISHED
  profile.rejectionReason = undefined
  profile.reviewedBy = actor.id as unknown as typeof profile.reviewedBy
  profile.reviewedAt = new Date()
  await profile.save()

  await recordAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.HR_PROFILE_APPROVED,
    resourceType: AUDIT_RESOURCE_TYPES.HR_PROFILE,
    resourceId: profile.id,
  })

  const hrUser = await User.findById(profile.userId).select('email firstName')
  if (hrUser) {
    enqueueEmail({ to: hrUser.email, ...buildProfileApproved(hrUser.firstName) })
  }

  return profile
}

/** Admin-only: rejects a profile that is pending review, or unpublishes a live one for cause. */
export async function rejectProfile(
  actor: Actor,
  profileId: string,
  reason: string,
): Promise<HRProfileDocument> {
  const profile = await HRProfile.findById(profileId)
  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }
  if (
    profile.status !== PROFILE_STATUS.PENDING_REVIEW &&
    profile.status !== PROFILE_STATUS.PUBLISHED
  ) {
    throw new ConflictError('Only a pending or published profile can be rejected.')
  }

  profile.status = PROFILE_STATUS.REJECTED
  profile.rejectionReason = reason
  profile.reviewedBy = actor.id as unknown as typeof profile.reviewedBy
  profile.reviewedAt = new Date()
  await profile.save()

  await recordAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.HR_PROFILE_REJECTED,
    resourceType: AUDIT_RESOURCE_TYPES.HR_PROFILE,
    resourceId: profile.id,
    metadata: { reason },
  })

  const hrUser = await User.findById(profile.userId).select('email firstName')
  if (hrUser) {
    enqueueEmail({ to: hrUser.email, ...buildProfileRejected(hrUser.firstName, reason) })
  }

  return profile
}

export interface AdminListProfilesQuery {
  page: number
  limit: number
  status?: string
  search?: string
}

export async function listProfilesForAdmin(
  query: AdminListProfilesQuery,
): Promise<{ data: ReturnType<typeof toAdminProfile>[]; pagination: Pagination }> {
  const filter: Record<string, unknown> = {}
  if (query.status) filter.status = query.status
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i')
    filter.$or = [{ headline: pattern }, { companyName: pattern }]
  }

  const total = await HRProfile.countDocuments(filter)
  const totalPages = Math.max(1, Math.ceil(total / query.limit))
  const page = Math.min(query.page, totalPages)

  const profiles = (await HRProfile.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * query.limit)
    .limit(query.limit)
    .populate('userId', 'firstName lastName email status')) as unknown as PopulatedProfile[]

  return {
    data: profiles.map(toAdminProfile),
    pagination: { page, limit: query.limit, total, totalPages },
  }
}

export async function getProfileForAdminById(profileId: string): Promise<HRProfileDocument> {
  const profile = await HRProfile.findById(profileId).populate(
    'userId',
    'firstName lastName email status',
  )
  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }
  return profile
}

export async function setAvailability(
  userId: string,
  isAvailable: boolean,
): Promise<HRProfileDocument> {
  const profile = await HRProfile.findOne({ userId })
  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }
  profile.isAvailable = isAvailable
  await profile.save()
  return profile
}

export interface ListProfilesResult {
  data: ReturnType<typeof toPublicProfile>[]
  pagination: Pagination
}

export async function listPublicProfiles(query: ListProfilesQuery): Promise<ListProfilesResult> {
  const {
    page,
    limit,
    search,
    specialization,
    language,
    minRateCents,
    maxRateCents,
    sortBy,
    sortOrder,
  } = query

  const filter: Record<string, unknown> = { status: PUBLISHED }

  if (specialization) {
    filter.specializations = specialization
  }
  if (language) {
    filter.languages = { $regex: new RegExp(`^${escapeRegex(language)}$`, 'i') }
  }
  if (minRateCents !== undefined || maxRateCents !== undefined) {
    const range: Record<string, number> = {}
    if (minRateCents !== undefined) range.$gte = minRateCents
    if (maxRateCents !== undefined) range.$lte = maxRateCents
    filter.hourlyRateCents = range
  }
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i')
    filter.$or = [{ headline: pattern }, { bio: pattern }]
  }

  const sort: Record<string, 1 | -1> =
    sortBy === 'newest'
      ? { createdAt: sortOrder === 'asc' ? 1 : -1 }
      : { [sortBy]: sortOrder === 'asc' ? 1 : -1 }

  const total = await HRProfile.countDocuments(filter)
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const safePage = Math.min(page, totalPages)

  const profiles = (await HRProfile.find(filter)
    .sort(sort)
    .skip((safePage - 1) * limit)
    .limit(limit)
    .populate('userId', 'firstName lastName')) as unknown as PopulatedProfile[]

  return {
    data: profiles.map(toPublicProfile),
    pagination: { page: safePage, total, totalPages, limit },
  }
}

export async function getPublicProfile(
  profileId: string,
): Promise<ReturnType<typeof toPublicProfile>> {
  const profile = (await HRProfile.findOne({
    _id: profileId,
    status: PUBLISHED,
  }).populate('userId', 'firstName lastName')) as unknown as PopulatedProfile | null

  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }
  return toPublicProfile(profile)
}

export function toOwnProfile(profile: HRProfileDocument): Record<string, unknown> {
  return {
    id: profile.id,
    headline: profile.headline,
    bio: profile.bio,
    specializations: profile.specializations,
    yearsOfExperience: profile.yearsOfExperience,
    companyName: profile.companyName ?? undefined,
    hourlyRateCents: profile.hourlyRateCents,
    currency: profile.currency,
    languages: profile.languages,
    city: profile.city ?? undefined,
    country: profile.country ?? undefined,
    profileImageUrl: profile.profileImageUrl ?? undefined,
    certifications: profile.certifications,
    workHistory: profile.workHistory,
    status: profile.status,
    rejectionReason: profile.rejectionReason ?? undefined,
    isAvailable: profile.isAvailable,
    rating: profile.rating,
    ratingCount: profile.ratingCount,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

export function toPublicProfile(
  profile: PopulatedProfile | HRProfileDocument,
): Record<string, unknown> {
  const populated = profile as PopulatedProfile
  const user = populated.userId as unknown as {
    id?: string
    firstName?: string
    lastName?: string
  } | null

  return {
    id: profile.id,
    user: user ? { id: user.id, firstName: user.firstName, lastName: user.lastName } : undefined,
    headline: profile.headline,
    bio: profile.bio,
    specializations: profile.specializations,
    yearsOfExperience: profile.yearsOfExperience,
    companyName: profile.companyName ?? undefined,
    hourlyRateCents: profile.hourlyRateCents,
    currency: profile.currency,
    languages: profile.languages,
    city: profile.city ?? undefined,
    country: profile.country ?? undefined,
    profileImageUrl: profile.profileImageUrl ?? undefined,
    certifications: profile.certifications,
    workHistory: profile.workHistory,
    isAvailable: profile.isAvailable,
    rating: profile.rating,
    ratingCount: profile.ratingCount,
    createdAt: profile.createdAt,
  }
}

export function toAdminProfile(
  profile: PopulatedProfile | HRProfileDocument,
): Record<string, unknown> {
  const populated = profile as PopulatedProfile
  const user = populated.userId as unknown as {
    id?: string
    firstName?: string
    lastName?: string
    email?: string
    status?: string
  } | null

  return {
    id: profile.id,
    user:
      user && typeof user === 'object' && 'email' in user
        ? {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            status: user.status,
          }
        : undefined,
    headline: profile.headline,
    specializations: profile.specializations,
    yearsOfExperience: profile.yearsOfExperience,
    companyName: profile.companyName ?? undefined,
    hourlyRateCents: profile.hourlyRateCents,
    currency: profile.currency,
    status: profile.status,
    rejectionReason: profile.rejectionReason ?? undefined,
    reviewedAt: profile.reviewedAt ?? undefined,
    isAvailable: profile.isAvailable,
    rating: profile.rating,
    ratingCount: profile.ratingCount,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
