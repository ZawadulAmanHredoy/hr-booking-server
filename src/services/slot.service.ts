import { AVAILABILITY_LIMITS, ACTIVE_BOOKING_STATUSES } from '../config/constants.js'
import { Booking } from '../models/Booking.js'
import type { AvailabilityDocument, BlockedDate, WorkingDay } from '../models/Availability.js'
import { BadRequestError } from '../utils/http-errors.js'
import {
  MINUTES_IN_DAY,
  addDays,
  addMinutes,
  dateKeysBetween,
  overlaps,
  timeToMinutes,
  wallTimeToUtc,
  weekdayOfDateKey,
} from '../utils/datetime.js'

export interface SlotConfig {
  timezone: string
  slotDurationMinutes: number
  bufferMinutes: number
  minNoticeMinutes: number
  maxAdvanceDays: number
  weeklyHours: WorkingDay[]
  blockedDates: BlockedDate[]
}

export interface BusyInterval {
  startAt: Date
  endAt: Date
}

export interface Slot {
  startAt: Date
  endAt: Date
}

export interface GenerateSlotsOptions {
  rangeStart: Date
  rangeEnd: Date
  now: Date
  busy: BusyInterval[]
}

/**
 * Pure slot generation. Wall-clock working hours live in the consultant's IANA timezone;
 * every value returned is a UTC instant so callers never do offset arithmetic themselves.
 */
export function generateSlots(config: SlotConfig, options: GenerateSlotsOptions): Slot[] {
  const { timezone, slotDurationMinutes, bufferMinutes } = config
  const { now, busy } = options

  const earliest = maxDate(options.rangeStart, addMinutes(now, config.minNoticeMinutes))
  const latest = minDate(options.rangeEnd, addDays(now, config.maxAdvanceDays))

  if (earliest >= latest) {
    return []
  }

  const intervalsByWeekday = new Map<number, WorkingDay['intervals']>()
  for (const day of config.weeklyHours) {
    intervalsByWeekday.set(day.weekday, day.intervals)
  }

  const blocksByDate = new Map<string, BlockedDate[]>()
  for (const block of config.blockedDates) {
    const existing = blocksByDate.get(block.date)
    if (existing) {
      existing.push(block)
    } else {
      blocksByDate.set(block.date, [block])
    }
  }

  const step = slotDurationMinutes + bufferMinutes
  const seen = new Set<number>()
  const slots: Slot[] = []

  for (const dateKey of dateKeysBetween(earliest, latest, timezone)) {
    const intervals = intervalsByWeekday.get(weekdayOfDateKey(dateKey, timezone))
    if (!intervals || intervals.length === 0) {
      continue
    }

    const blocks = blocksByDate.get(dateKey) ?? []
    if (blocks.some((block) => !block.startTime || !block.endTime)) {
      continue
    }

    for (const interval of intervals) {
      const intervalStart = timeToMinutes(interval.start)
      const intervalEnd = timeToMinutes(interval.end)

      for (
        let offset = intervalStart;
        offset + slotDurationMinutes <= intervalEnd;
        offset += step
      ) {
        if (isBlocked(blocks, offset, offset + slotDurationMinutes)) {
          continue
        }

        const startAt = wallTimeToUtc(dateKey, offset, timezone)
        if (!startAt) {
          continue
        }
        const endAt = addMinutes(startAt, slotDurationMinutes)

        if (startAt < earliest || startAt >= latest) {
          continue
        }
        if (seen.has(startAt.getTime())) {
          continue
        }
        if (busy.some((b) => overlaps(startAt, endAt, b.startAt, b.endAt))) {
          continue
        }

        seen.add(startAt.getTime())
        slots.push({ startAt, endAt })
      }
    }
  }

  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

export interface AvailableSlotsResult {
  timezone: string
  slotDurationMinutes: number
  from: Date
  to: Date
  slots: Slot[]
}

/** Slots a client may still book, with active bookings for the consultant removed. */
export async function getAvailableSlots(
  availability: AvailabilityDocument,
  range: { from: Date; to: Date },
  now = new Date(),
): Promise<AvailableSlotsResult> {
  assertRange(range.from, range.to)

  const busy = await Booking.find({
    hrUserId: availability.hrUserId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    endAt: { $gt: range.from },
    startAt: { $lt: range.to },
  })
    .select('startAt endAt')
    .lean()

  const slots = generateSlots(toSlotConfig(availability), {
    rangeStart: range.from,
    rangeEnd: range.to,
    now,
    busy: busy.map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
  })

  return {
    timezone: availability.timezone,
    slotDurationMinutes: availability.slotDurationMinutes,
    from: range.from,
    to: range.to,
    slots,
  }
}

/** True when the instant is a slot the consultant actually offers (blocked dates included). */
export function isOfferedSlot(
  availability: AvailabilityDocument,
  startAt: Date,
  now = new Date(),
): boolean {
  const slots = generateSlots(toSlotConfig(availability), {
    rangeStart: startAt,
    rangeEnd: addMinutes(startAt, 1),
    now,
    busy: [],
  })

  return slots.some((slot) => slot.startAt.getTime() === startAt.getTime())
}

export function toSlotConfig(availability: AvailabilityDocument): SlotConfig {
  return {
    timezone: availability.timezone,
    slotDurationMinutes: availability.slotDurationMinutes,
    bufferMinutes: availability.bufferMinutes,
    minNoticeMinutes: availability.minNoticeMinutes,
    maxAdvanceDays: availability.maxAdvanceDays,
    weeklyHours: availability.weeklyHours,
    blockedDates: availability.blockedDates,
  }
}

function isBlocked(blocks: BlockedDate[], startMinutes: number, endMinutes: number): boolean {
  return blocks.some((block) => {
    if (!block.startTime || !block.endTime) {
      return true
    }
    const blockStart = timeToMinutes(block.startTime)
    const blockEnd = timeToMinutes(block.endTime)
    return startMinutes < blockEnd && endMinutes > blockStart
  })
}

function assertRange(from: Date, to: Date): void {
  if (from >= to) {
    throw new BadRequestError('The end of the range must be after its start.')
  }
  const days = (to.getTime() - from.getTime()) / (MINUTES_IN_DAY * 60_000)
  if (days > AVAILABILITY_LIMITS.SLOT_RANGE_DAYS_MAX) {
    throw new BadRequestError(
      `Slot ranges are limited to ${AVAILABILITY_LIMITS.SLOT_RANGE_DAYS_MAX} days.`,
    )
  }
}

function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b
}

function minDate(a: Date, b: Date): Date {
  return a < b ? a : b
}
