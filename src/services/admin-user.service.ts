import { User, type UserDocument } from '../models/User.js'
import { RefreshToken } from '../models/RefreshToken.js'
import { HRProfile } from '../models/HRProfile.js'
import { Availability } from '../models/Availability.js'
import { OAuthAccount } from '../models/OAuthAccount.js'
import { Meeting } from '../models/Meeting.js'
import { Booking } from '../models/Booking.js'
import { Report } from '../models/Report.js'
import {
  ACTIVE_BOOKING_STATUSES,
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  USER_ROLES,
  USER_STATUS,
} from '../config/constants.js'
import { BadRequestError, ConflictError, NotFoundError } from '../utils/http-errors.js'
import { logger } from '../config/logger.js'
import { recordAuditLog } from './audit-log.service.js'
import { cancelBooking } from './booking.service.js'
import { enqueueEmail } from './email/index.js'
import {
  buildAccountReactivated,
  buildAccountSuspended,
} from './email/templates/account.templates.js'
import type { Pagination } from '../utils/response.js'

export interface AdminListUsersQuery {
  page: number
  limit: number
  role?: string
  status?: string
  search?: string
}

export async function listUsers(
  query: AdminListUsersQuery,
): Promise<{ data: UserDocument[]; pagination: Pagination }> {
  const filter: Record<string, unknown> = {}
  if (query.role) filter.role = query.role
  if (query.status) filter.status = query.status
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i')
    filter.$or = [{ email: pattern }, { firstName: pattern }, { lastName: pattern }]
  }

  const total = await User.countDocuments(filter)
  const totalPages = Math.max(1, Math.ceil(total / query.limit))
  const page = Math.min(query.page, totalPages)

  const data = await User.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * query.limit)
    .limit(query.limit)

  return { data, pagination: { page, limit: query.limit, total, totalPages } }
}

export interface UserDetail {
  user: UserDocument
  hrProfile?: { id: string; status: string } | null
}

export async function getUserDetail(userId: string): Promise<UserDetail> {
  const user = await User.findById(userId)
  if (!user) {
    throw new NotFoundError('User not found.')
  }
  if (user.role !== USER_ROLES.HR) {
    return { user }
  }
  const profile = await HRProfile.findOne({ userId }).select('status')
  return { user, hrProfile: profile ? { id: profile.id, status: profile.status } : null }
}

export async function suspendUser(
  actor: { id: string; role: string },
  userId: string,
  reason: string,
): Promise<UserDocument> {
  const user = await User.findById(userId)
  if (!user) {
    throw new NotFoundError('User not found.')
  }
  if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPER_ADMIN) {
    throw new BadRequestError('Admin accounts cannot be suspended here.')
  }
  if (user.status === USER_STATUS.SUSPENDED) {
    throw new ConflictError('This account is already suspended.')
  }

  user.status = USER_STATUS.SUSPENDED
  await user.save()
  // Suspending should end any active session immediately, the same posture as a password reset.
  await RefreshToken.deleteMany({ userId: user.id })

  await recordAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.USER_SUSPENDED,
    resourceType: AUDIT_RESOURCE_TYPES.USER,
    resourceId: user.id,
    metadata: { reason },
  })

  enqueueEmail({ to: user.email, ...buildAccountSuspended(user.firstName, reason) })

  return user
}

export async function reactivateUser(
  actor: { id: string; role: string },
  userId: string,
): Promise<UserDocument> {
  const user = await User.findById(userId)
  if (!user) {
    throw new NotFoundError('User not found.')
  }
  if (user.status !== USER_STATUS.SUSPENDED) {
    throw new ConflictError('This account is not suspended.')
  }

  user.status = USER_STATUS.ACTIVE
  user.failedLoginAttempts = 0
  user.lockedUntil = undefined
  await user.save()

  await recordAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.USER_REACTIVATED,
    resourceType: AUDIT_RESOURCE_TYPES.USER,
    resourceId: user.id,
  })

  enqueueEmail({ to: user.email, ...buildAccountReactivated(user.firstName) })

  return user
}

export interface DeletedUserSummary {
  email: string
  firstName: string
  lastName: string
}

/**
 * Cancels any active bookings first (through the normal cancel flow, so the counterpart gets a
 * cancellation email and the meeting is torn down), then hard-deletes the account and everything
 * that only makes sense in relation to it. Audit logs are kept — they're a record of what an
 * admin did, not of the deleted user's own data.
 */
export async function deleteUser(
  actor: { id: string; role: string },
  userId: string,
): Promise<DeletedUserSummary> {
  const user = await User.findById(userId)
  if (!user) {
    throw new NotFoundError('User not found.')
  }
  if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPER_ADMIN) {
    throw new BadRequestError('Admin accounts cannot be deleted here.')
  }

  const activeBookings = await Booking.find({
    $or: [{ userId: user._id }, { hrUserId: user._id }],
    status: { $in: ACTIVE_BOOKING_STATUSES },
  }).select('_id')

  for (const booking of activeBookings) {
    await cancelBooking(actor, String(booking._id), "The other party's account was deleted.").catch(
      (err: unknown) => {
        logger.warn(
          { bookingId: String(booking._id), err: err instanceof Error ? err.message : err },
          'Failed to cancel a booking while deleting a user; deleting the record anyway',
        )
      },
    )
  }

  const bookingIds = (
    await Booking.find({ $or: [{ userId: user._id }, { hrUserId: user._id }] }).select('_id')
  ).map((b) => b._id)

  await Meeting.deleteMany({ bookingId: { $in: bookingIds } })
  await Booking.deleteMany({ _id: { $in: bookingIds } })
  await RefreshToken.deleteMany({ userId: user._id })
  await Report.deleteMany({ $or: [{ reporterId: user._id }, { hrUserId: user._id }] })

  if (user.role === USER_ROLES.HR) {
    await Availability.deleteMany({ hrUserId: user._id })
    await OAuthAccount.deleteMany({ userId: user._id })
    await HRProfile.deleteMany({ userId: user._id })
  }

  const summary: DeletedUserSummary = {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  }

  await User.deleteOne({ _id: user._id })

  await recordAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.USER_DELETED,
    resourceType: AUDIT_RESOURCE_TYPES.USER,
    resourceId: userId,
    metadata: { email: summary.email },
  })

  return summary
}

export function toAdminUser(user: UserDocument): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    isEmailVerified: user.isEmailVerified,
    phone: user.phone ?? undefined,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
