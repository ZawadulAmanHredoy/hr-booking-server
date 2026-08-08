import { PROFILE_STATUS } from '../config/constants.js'
import { Availability, type AvailabilityDocument } from '../models/Availability.js'
import { HRProfile, type HRProfileDocument } from '../models/HRProfile.js'
import { NotFoundError } from '../utils/http-errors.js'
import type { UpdateAvailabilityInput } from '../validators/availability.validator.js'

/**
 * The consultant's own record, created empty on first read. An empty weekly schedule means
 * nothing is bookable until the consultant explicitly publishes working hours.
 */
export async function getOrCreateAvailability(hrUserId: string): Promise<AvailabilityDocument> {
  const existing = await Availability.findOne({ hrUserId })
  if (existing) {
    return existing
  }
  return Availability.create({ hrUserId })
}

export async function updateAvailability(
  hrUserId: string,
  input: UpdateAvailabilityInput,
): Promise<AvailabilityDocument> {
  const availability = await getOrCreateAvailability(hrUserId)

  availability.timezone = input.timezone
  availability.slotDurationMinutes = input.slotDurationMinutes
  availability.bufferMinutes = input.bufferMinutes
  availability.minNoticeMinutes = input.minNoticeMinutes
  availability.maxAdvanceDays = input.maxAdvanceDays
  availability.weeklyHours = input.weeklyHours
  availability.blockedDates = input.blockedDates

  await availability.save()
  return availability
}

/** Availability for a consultant, unsaved defaults when they never configured one. */
export async function getAvailabilityForHr(hrUserId: string): Promise<AvailabilityDocument> {
  const existing = await Availability.findOne({ hrUserId })
  return existing ?? new Availability({ hrUserId })
}

export interface PublishedProfileAvailability {
  profile: HRProfileDocument
  availability: AvailabilityDocument
}

export async function getPublishedProfileAvailability(
  profileId: string,
): Promise<PublishedProfileAvailability> {
  const profile = await HRProfile.findOne({ _id: profileId, status: PROFILE_STATUS.PUBLISHED })
  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }

  const availability = await getAvailabilityForHr(String(profile.userId))
  return { profile, availability }
}

export function toAvailabilityResponse(
  availability: AvailabilityDocument,
): Record<string, unknown> {
  return {
    timezone: availability.timezone,
    slotDurationMinutes: availability.slotDurationMinutes,
    bufferMinutes: availability.bufferMinutes,
    minNoticeMinutes: availability.minNoticeMinutes,
    maxAdvanceDays: availability.maxAdvanceDays,
    weeklyHours: availability.weeklyHours.map((day) => ({
      weekday: day.weekday,
      intervals: day.intervals.map((interval) => ({ start: interval.start, end: interval.end })),
    })),
    blockedDates: availability.blockedDates.map((block) => ({
      date: block.date,
      startTime: block.startTime ?? undefined,
      endTime: block.endTime ?? undefined,
      reason: block.reason ?? undefined,
    })),
    updatedAt: availability.updatedAt,
  }
}

/** What a prospective client is allowed to see about a consultant's schedule. */
export function toPublicScheduleResponse(
  availability: AvailabilityDocument,
): Record<string, unknown> {
  return {
    timezone: availability.timezone,
    slotDurationMinutes: availability.slotDurationMinutes,
    minNoticeMinutes: availability.minNoticeMinutes,
    maxAdvanceDays: availability.maxAdvanceDays,
    weeklyHours: availability.weeklyHours.map((day) => ({
      weekday: day.weekday,
      intervals: day.intervals.map((interval) => ({ start: interval.start, end: interval.end })),
    })),
  }
}
