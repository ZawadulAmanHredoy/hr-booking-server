import { HRProfile, type HRProfileDocument } from '../models/HRProfile.js'
import { User, type UserDocument } from '../models/User.js'
import { PROFILE_STATUS, USER_ROLES } from '../config/constants.js'
import { NotFoundError } from '../utils/http-errors.js'
import type { Pagination } from '../utils/response.js'
import type { ListProfilesQuery, UpsertProfileInput } from '../validators/hrProfile.validator.js'

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

  const profile = await HRProfile.create({
    userId,
    ...input,
    status: PROFILE_STATUS.DRAFT,
  })

  return { profile, upgraded }
}

export async function getProfileByUserId(userId: string): Promise<HRProfileDocument> {
  const profile = await HRProfile.findOne({ userId })
  if (!profile) {
    throw new NotFoundError('Profile not found. Complete onboarding to create one.')
  }
  return profile
}

export async function setProfileStatus(
  userId: string,
  status: 'DRAFT' | 'PUBLISHED',
): Promise<HRProfileDocument> {
  const profile = await HRProfile.findOne({ userId })
  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }
  profile.status = status
  await profile.save()
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

export async function listPublicProfiles(
  query: ListProfilesQuery,
): Promise<ListProfilesResult> {
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
    hourlyRateCents: profile.hourlyRateCents,
    currency: profile.currency,
    languages: profile.languages,
    city: profile.city ?? undefined,
    country: profile.country ?? undefined,
    profileImageUrl: profile.profileImageUrl ?? undefined,
    certifications: profile.certifications,
    status: profile.status,
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
    user: user
      ? { id: user.id, firstName: user.firstName, lastName: user.lastName }
      : undefined,
    headline: profile.headline,
    bio: profile.bio,
    specializations: profile.specializations,
    yearsOfExperience: profile.yearsOfExperience,
    hourlyRateCents: profile.hourlyRateCents,
    currency: profile.currency,
    languages: profile.languages,
    city: profile.city ?? undefined,
    country: profile.country ?? undefined,
    profileImageUrl: profile.profileImageUrl ?? undefined,
    certifications: profile.certifications,
    isAvailable: profile.isAvailable,
    rating: profile.rating,
    ratingCount: profile.ratingCount,
    createdAt: profile.createdAt,
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
