import { z } from 'zod'
import {
  ADMIN_LIMITS,
  BOOKING_STATUS,
  PROFILE_STATUS,
  USER_ROLES,
  USER_STATUS,
} from '../config/constants.js'

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id')
const pageSchema = z.coerce.number().int().min(1).default(1)
const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(ADMIN_LIMITS.PAGE_SIZE_MAX)
  .default(ADMIN_LIMITS.PAGE_SIZE_DEFAULT)

export const adminIdParamsSchema = z.object({
  id: objectIdSchema,
})

export const listUsersQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
  role: z.enum(Object.values(USER_ROLES) as [string, ...string[]]).optional(),
  status: z.enum(Object.values(USER_STATUS) as [string, ...string[]]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
})

export const suspendUserSchema = z.object({
  reason: z.string().trim().min(3).max(ADMIN_LIMITS.SUSPEND_REASON_MAX),
})

export const listAdminProfilesQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
  status: z.enum(Object.values(PROFILE_STATUS) as [string, ...string[]]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
})

export const rejectProfileSchema = z.object({
  reason: z.string().trim().min(3).max(ADMIN_LIMITS.REJECTION_REASON_MAX),
})

export const listAdminBookingsQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
  status: z.enum(Object.values(BOOKING_STATUS) as [string, ...string[]]).optional(),
  userId: objectIdSchema.optional(),
  hrUserId: objectIdSchema.optional(),
  from: z.iso
    .datetime({ offset: true })
    .transform((v) => new Date(v))
    .optional(),
  to: z.iso
    .datetime({ offset: true })
    .transform((v) => new Date(v))
    .optional(),
})

export const listAuditLogsQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
  action: z.string().trim().min(1).max(60).optional(),
  actorId: objectIdSchema.optional(),
  resourceType: z.string().trim().min(1).max(40).optional(),
})

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>
export type ListAdminProfilesQuery = z.infer<typeof listAdminProfilesQuerySchema>
export type ListAdminBookingsQuery = z.infer<typeof listAdminBookingsQuerySchema>
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>
