import { z } from 'zod'
import { BOOKING_LIMITS, BOOKING_STATUS, MEETING_PROVIDERS } from '../config/constants.js'
import { isValidTimezone } from '../utils/datetime.js'

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id')

const startAtSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()), 'Invalid start time')

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimezone, 'Unknown IANA timezone')

export const createBookingSchema = z.object({
  profileId: objectIdSchema,
  startAt: startAtSchema,
  timezone: timezoneSchema.optional(),
  notes: z.string().trim().max(BOOKING_LIMITS.NOTES_MAX).optional(),
  meetingProvider: z
    .enum([MEETING_PROVIDERS.GOOGLE_MEET, MEETING_PROVIDERS.ZOOM])
    .default(MEETING_PROVIDERS.GOOGLE_MEET),
})

export const cancelBookingSchema = z.object({
  reason: z.string().trim().max(BOOKING_LIMITS.CANCEL_REASON_MAX).optional(),
})

export const rescheduleBookingSchema = z.object({
  startAt: startAtSchema,
  timezone: timezoneSchema.optional(),
})

export const bookingIdParamsSchema = z.object({
  id: objectIdSchema,
})

export const listBookingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BOOKING_LIMITS.PAGE_SIZE_MAX)
    .default(BOOKING_LIMITS.PAGE_SIZE_DEFAULT),
  role: z.enum(['user', 'hr']).optional(),
  scope: z.enum(['upcoming', 'past', 'all']).default('all'),
  status: z.enum(Object.values(BOOKING_STATUS) as [string, ...string[]]).optional(),
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>
