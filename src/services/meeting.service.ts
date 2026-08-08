import mongoose from 'mongoose'
import {
  ACTIVE_BOOKING_STATUSES,
  MEETING_STATUS,
  type MeetingProvider,
} from '../config/constants.js'
import { logger } from '../config/logger.js'
import { Booking, type BookingDocument } from '../models/Booking.js'
import { Meeting, type MeetingDocument } from '../models/Meeting.js'
import { User } from '../models/User.js'
import { getMeetingProvider, isSupportedMeetingProvider } from '../integrations/meeting/index.js'
import { OAuthConnectionError } from './oauth.service.js'
import { GoogleApiError } from '../integrations/google/google-oauth.client.js'

const ERROR_MAX_LENGTH = 300

/**
 * Creates (or repairs) the conference for a booking. External failures are recorded on the
 * meeting rather than thrown, so a provider outage can never lose a confirmed booking — the
 * participants simply see a retryable "not created yet" state.
 */
export async function ensureMeetingForBooking(bookingId: string): Promise<MeetingDocument | null> {
  const booking = await Booking.findById(bookingId)
  if (!booking) {
    return null
  }

  const meeting = await upsertMeetingRecord(booking)

  if (meeting.status === MEETING_STATUS.CREATED && meeting.externalMeetingId) {
    return meeting
  }
  if (!isSupportedMeetingProvider(booking.meetingProvider)) {
    return recordFailure(meeting, `${booking.meetingProvider} meetings are not supported yet.`)
  }

  try {
    const details = await getMeetingProvider(booking.meetingProvider).createMeeting({
      bookingId: booking.id,
      hostUserId: String(booking.hrUserId),
      title: await buildTitle(booking),
      description: buildDescription(booking),
      startAt: booking.startAt,
      endAt: booking.endAt,
      timeZone: booking.hrTimezone,
      attendees: await buildAttendees(booking),
    })

    meeting.status = MEETING_STATUS.CREATED
    meeting.externalMeetingId = details.externalMeetingId
    meeting.externalCalendarId = details.externalCalendarId
    meeting.meetingUrl = details.meetingUrl
    meeting.set('lastError', undefined)
    await meeting.save()

    logger.info(
      { bookingId: booking.id, provider: booking.meetingProvider },
      'Meeting created for booking',
    )

    return meeting
  } catch (err) {
    return recordFailure(meeting, describe(err))
  }
}

/** Moves an existing conference after a reschedule; a failure downgrades it to retryable. */
export async function syncMeetingTimes(bookingId: string): Promise<MeetingDocument | null> {
  const booking = await Booking.findById(bookingId)
  if (!booking) {
    return null
  }

  const meeting = await Meeting.findOne({ bookingId: booking._id })
  if (!meeting) {
    return ensureMeetingForBooking(bookingId)
  }

  meeting.startTime = booking.startAt
  meeting.endTime = booking.endAt

  if (
    meeting.status !== MEETING_STATUS.CREATED ||
    !meeting.externalMeetingId ||
    !meeting.externalCalendarId
  ) {
    await meeting.save()
    return ensureMeetingForBooking(bookingId)
  }

  try {
    const details = await getMeetingProvider(booking.meetingProvider).updateMeeting({
      hostUserId: String(booking.hrUserId),
      externalMeetingId: meeting.externalMeetingId,
      externalCalendarId: meeting.externalCalendarId,
      startAt: booking.startAt,
      endAt: booking.endAt,
      timeZone: booking.hrTimezone,
    })

    meeting.meetingUrl = details.meetingUrl ?? meeting.meetingUrl
    meeting.set('lastError', undefined)
    await meeting.save()

    logger.info({ bookingId: booking.id }, 'Meeting moved with the booking')

    return meeting
  } catch (err) {
    return recordFailure(meeting, describe(err))
  }
}

/** Removes the conference when a booking is cancelled. Never blocks the cancellation. */
export async function cancelMeetingForBooking(bookingId: string): Promise<MeetingDocument | null> {
  const booking = await Booking.findById(bookingId)
  const meeting = await Meeting.findOne({ bookingId: new mongoose.Types.ObjectId(bookingId) })
  if (!booking || !meeting) {
    return null
  }

  if (meeting.status === MEETING_STATUS.CREATED && meeting.externalMeetingId) {
    try {
      await getMeetingProvider(booking.meetingProvider).cancelMeeting({
        hostUserId: String(booking.hrUserId),
        externalMeetingId: meeting.externalMeetingId,
        externalCalendarId: meeting.externalCalendarId ?? 'primary',
      })
    } catch (err) {
      // The booking is already cancelled locally; a stale calendar entry is not worth failing on.
      logger.warn(
        { bookingId: booking.id, err: describe(err) },
        'Could not remove the provider meeting',
      )
    }
  }

  meeting.status = MEETING_STATUS.CANCELLED
  meeting.set('lastError', undefined)
  await meeting.save()

  return meeting
}

export async function getMeetingForBooking(bookingId: string): Promise<MeetingDocument | null> {
  return Meeting.findOne({ bookingId: new mongoose.Types.ObjectId(bookingId) })
}

export async function getMeetingsForBookings(
  bookingIds: mongoose.Types.ObjectId[],
): Promise<Map<string, MeetingDocument>> {
  const meetings = await Meeting.find({ bookingId: { $in: bookingIds } })
  return new Map(meetings.map((meeting) => [String(meeting.bookingId), meeting]))
}

export function toMeetingResponse(
  meeting: MeetingDocument | null,
  provider: MeetingProvider,
): Record<string, unknown> {
  if (!meeting) {
    return { provider, status: MEETING_STATUS.PENDING, meetingUrl: undefined }
  }

  return {
    provider: meeting.provider,
    status: meeting.status,
    meetingUrl: meeting.meetingUrl ?? undefined,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    lastError: meeting.lastError ?? undefined,
    attempts: meeting.attempts,
  }
}

export function isRetryable(meeting: MeetingDocument | null, booking: BookingDocument): boolean {
  return (
    ACTIVE_BOOKING_STATUSES.includes(booking.status) &&
    booking.endAt.getTime() > Date.now() &&
    (!meeting ||
      meeting.status === MEETING_STATUS.PENDING ||
      meeting.status === MEETING_STATUS.FAILED)
  )
}

async function upsertMeetingRecord(booking: BookingDocument): Promise<MeetingDocument> {
  const existing = await Meeting.findOne({ bookingId: booking._id })
  if (existing) {
    existing.startTime = booking.startAt
    existing.endTime = booking.endAt
    existing.provider = booking.meetingProvider
    return existing
  }

  return Meeting.create({
    bookingId: booking._id,
    provider: booking.meetingProvider,
    status: MEETING_STATUS.PENDING,
    startTime: booking.startAt,
    endTime: booking.endAt,
  })
}

async function recordFailure(meeting: MeetingDocument, message: string): Promise<MeetingDocument> {
  meeting.status = MEETING_STATUS.FAILED
  meeting.lastError = message.slice(0, ERROR_MAX_LENGTH)
  meeting.attempts += 1
  await meeting.save()

  logger.warn(
    { bookingId: String(meeting.bookingId), attempts: meeting.attempts, reason: meeting.lastError },
    'Meeting creation failed',
  )

  return meeting
}

async function buildAttendees(
  booking: BookingDocument,
): Promise<{ email: string; displayName?: string }[]> {
  const users = await User.find({ _id: { $in: [booking.userId, booking.hrUserId] } }).select(
    'email firstName lastName',
  )

  return users.map((user) => ({
    email: user.email,
    displayName: `${user.firstName} ${user.lastName}`.trim(),
  }))
}

async function buildTitle(booking: BookingDocument): Promise<string> {
  const users = await User.find({ _id: { $in: [booking.userId, booking.hrUserId] } }).select(
    'firstName lastName',
  )
  const names = users.map((user) => `${user.firstName} ${user.lastName}`.trim())

  return names.length === 2 ? `HR consultation — ${names[0]} & ${names[1]}` : 'HR consultation'
}

function buildDescription(booking: BookingDocument): string {
  const lines = [`Booking reference: ${booking.id}`, `Duration: ${booking.durationMinutes} minutes`]
  if (booking.notes) {
    lines.push('', 'Notes from the client:', booking.notes)
  }
  return lines.join('\n')
}

function describe(err: unknown): string {
  if (err instanceof OAuthConnectionError || err instanceof GoogleApiError) {
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return 'The meeting provider could not be reached.'
}
