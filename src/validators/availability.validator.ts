import { z } from 'zod'
import { AVAILABILITY_DEFAULTS, AVAILABILITY_LIMITS, SLOT_DURATIONS } from '../config/constants.js'
import { isValidTimezone, timeToMinutes } from '../utils/datetime.js'

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Times must use the 24-hour HH:mm format')

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must use the YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Invalid calendar date')

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimezone, 'Unknown IANA timezone')

const intervalSchema = z
  .object({
    start: timeSchema,
    end: timeSchema,
  })
  .refine(
    (interval) => timeToMinutes(interval.end) > timeToMinutes(interval.start),
    'An interval must end after it starts',
  )

const workingDaySchema = z
  .object({
    weekday: z.coerce.number().int().min(0).max(6),
    intervals: z.array(intervalSchema).max(AVAILABILITY_LIMITS.INTERVALS_PER_DAY_MAX),
  })
  .refine((day) => !hasOverlappingIntervals(day.intervals), 'Working intervals must not overlap')

const blockedDateSchema = z
  .object({
    date: dateKeySchema,
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    reason: z.string().trim().max(AVAILABILITY_LIMITS.BLOCK_REASON_MAX).optional(),
  })
  .refine(
    (block) => Boolean(block.startTime) === Boolean(block.endTime),
    'Provide both a start and an end time, or neither for a full-day block',
  )
  .refine(
    (block) =>
      !block.startTime ||
      !block.endTime ||
      timeToMinutes(block.endTime) > timeToMinutes(block.startTime),
    'A blocked range must end after it starts',
  )

export const updateAvailabilitySchema = z.object({
  timezone: timezoneSchema,
  slotDurationMinutes: z.coerce
    .number()
    .int()
    .refine(
      (value) => (SLOT_DURATIONS as readonly number[]).includes(value),
      `Slot duration must be one of ${SLOT_DURATIONS.join(', ')} minutes`,
    )
    .default(AVAILABILITY_DEFAULTS.SLOT_DURATION_MINUTES),
  bufferMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(AVAILABILITY_LIMITS.BUFFER_MINUTES_MAX)
    .default(AVAILABILITY_DEFAULTS.BUFFER_MINUTES),
  minNoticeMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(AVAILABILITY_LIMITS.MIN_NOTICE_MINUTES_MAX)
    .default(AVAILABILITY_DEFAULTS.MIN_NOTICE_MINUTES),
  maxAdvanceDays: z.coerce
    .number()
    .int()
    .min(AVAILABILITY_LIMITS.MAX_ADVANCE_DAYS_MIN)
    .max(AVAILABILITY_LIMITS.MAX_ADVANCE_DAYS_MAX)
    .default(AVAILABILITY_DEFAULTS.MAX_ADVANCE_DAYS),
  weeklyHours: z
    .array(workingDaySchema)
    .max(7)
    .default([])
    .refine(
      (days) => new Set(days.map((day) => day.weekday)).size === days.length,
      'Each weekday may appear only once',
    ),
  blockedDates: z.array(blockedDateSchema).max(AVAILABILITY_LIMITS.BLOCKED_DATES_MAX).default([]),
})

export const profileIdParamsSchema = z.object({
  profileId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid profile id'),
})

const instantSchema = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .transform((value) => new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value))

export const slotsQuerySchema = z.object({
  from: instantSchema.optional(),
  to: instantSchema.optional(),
})

export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>
export type SlotsQuery = z.infer<typeof slotsQuerySchema>

function hasOverlappingIntervals(intervals: { start: string; end: string }[]): boolean {
  const sorted = [...intervals].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
  return sorted.some(
    (interval, index) =>
      index > 0 && timeToMinutes(interval.start) < timeToMinutes(sorted[index - 1].end),
  )
}
