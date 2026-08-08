import mongoose from 'mongoose'
import {
  ACTIVE_BOOKING_STATUSES,
  BOOKING_LIMITS,
  BOOKING_STATUS,
  CANCELLED_BY,
  PROFILE_STATUS,
  USER_ROLES,
  type CancelledBy,
  type Currency,
} from '../config/constants.js'
import { logger } from '../config/logger.js'
import { Booking, buildSlotKey, type BookingDocument } from '../models/Booking.js'
import { HRProfile } from '../models/HRProfile.js'
import { User } from '../models/User.js'
import type { UserDocument } from '../models/User.js'
import type { AvailabilityDocument } from '../models/Availability.js'
import { getAvailabilityForHr } from './availability.service.js'
import { isOfferedSlot } from './slot.service.js'
import {
  ensureMeetingForBooking,
  getMeetingForBooking,
  getMeetingsForBookings,
  isRetryable,
  toMeetingResponse,
} from './meeting.service.js'
import type { MeetingDocument } from '../models/Meeting.js'
import { addMinutes } from '../utils/datetime.js'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SlotUnavailableError,
} from '../utils/http-errors.js'
import type { Pagination } from '../utils/response.js'
import type {
  CreateBookingInput,
  ListBookingsQuery,
  RescheduleBookingInput,
} from '../validators/booking.validator.js'
import { getMeetingQueue } from '../queues/meeting.queue.js'
import { getReminderQueue, REMINDER_LEAD_MS, reminderJobId } from '../queues/reminder.queue.js'
import { enqueueEmail } from './email/index.js'
import {
  buildBookingConfirmation,
  buildBookingCancellation,
  buildBookingReschedule,
} from './email/templates/booking.templates.js'

const DUPLICATE_KEY = 11000
const TERMINAL_STATUSES = [
  BOOKING_STATUS.CANCELLED,
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.NO_SHOW,
]

export interface Actor {
  id: string
  role: string
}

type PopulatedUser = Pick<UserDocument, 'id' | 'firstName' | 'lastName'>

export async function createBooking(
  actor: Actor,
  input: CreateBookingInput,
): Promise<BookingDocument> {
  const profile = await HRProfile.findOne({
    _id: input.profileId,
    status: PROFILE_STATUS.PUBLISHED,
  })
  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }
  if (!profile.isAvailable) {
    throw new ConflictError('This consultant is not accepting bookings right now.')
  }

  const hrUserId = String(profile.userId)
  if (hrUserId === actor.id) {
    throw new BadRequestError('You cannot book a consultation with yourself.')
  }

  const availability = await getAvailabilityForHr(hrUserId)
  if (!isOfferedSlot(availability, input.startAt)) {
    throw new SlotUnavailableError('That time is not offered by this consultant.')
  }

  const startAt = input.startAt
  const endAt = addMinutes(startAt, availability.slotDurationMinutes)

  await assertClientIsFree(actor.id, startAt, endAt)
  await assertConsultantIsFree(hrUserId, startAt, endAt)

  const booking = await insertBooking({
    actor,
    availability,
    profileId: profile.id,
    hrUserId,
    startAt,
    endAt,
    input,
    priceCents: prorate(profile.hourlyRateCents, availability.slotDurationMinutes),
    currency: profile.currency,
  })

  logger.info(
    { bookingId: booking.id, userId: actor.id, hrUserId, startAt: startAt.toISOString() },
    'Booking created',
  )

  await dispatchBookingCreated(booking)

  return booking
}

export async function listBookings(
  actor: Actor,
  query: ListBookingsQuery,
): Promise<{ data: BookingDocument[]; pagination: Pagination }> {
  const asConsultant = resolveScopeRole(actor, query.role) === 'hr'
  const filter: Record<string, unknown> = asConsultant
    ? { hrUserId: actor.id }
    : { userId: actor.id }

  const now = new Date()
  if (query.scope === 'upcoming') {
    filter.startAt = { $gte: now }
    filter.status = { $in: ACTIVE_BOOKING_STATUSES }
  } else if (query.scope === 'past') {
    filter.$or = [{ startAt: { $lt: now } }, { status: { $in: TERMINAL_STATUSES } }]
  }
  if (query.status) {
    filter.status = query.status
  }

  const total = await Booking.countDocuments(filter)
  const totalPages = Math.max(1, Math.ceil(total / query.limit))
  const page = Math.min(query.page, totalPages)
  const sort: Record<string, 1 | -1> = query.scope === 'upcoming' ? { startAt: 1 } : { startAt: -1 }

  const bookings = await Booking.find(filter)
    .sort(sort)
    .skip((page - 1) * query.limit)
    .limit(query.limit)
    .populate('userId', 'firstName lastName')
    .populate('hrUserId', 'firstName lastName')
    .populate('hrProfileId', 'headline')

  return {
    data: bookings,
    pagination: { page, limit: query.limit, total, totalPages },
  }
}

export async function getBookingForActor(
  actor: Actor,
  bookingId: string,
): Promise<BookingDocument> {
  const booking = await Booking.findById(bookingId)
    .populate('userId', 'firstName lastName')
    .populate('hrUserId', 'firstName lastName')
    .populate('hrProfileId', 'headline')

  if (!booking) {
    throw new NotFoundError('Booking not found.')
  }
  assertParticipant(actor, booking)
  return booking
}

export async function cancelBooking(
  actor: Actor,
  bookingId: string,
  reason?: string,
): Promise<BookingDocument> {
  const booking = await Booking.findById(bookingId)
  if (!booking) {
    throw new NotFoundError('Booking not found.')
  }
  const role = assertParticipant(actor, booking)

  if (!isActive(booking)) {
    throw new ConflictError('This booking can no longer be cancelled.')
  }

  const now = new Date()
  if (booking.startAt <= now) {
    throw new ConflictError('This consultation has already started.')
  }
  if (
    role === CANCELLED_BY.USER &&
    booking.startAt.getTime() - now.getTime() < BOOKING_LIMITS.CANCEL_NOTICE_MINUTES * 60_000
  ) {
    throw new ConflictError(
      `Consultations must be cancelled at least ${BOOKING_LIMITS.CANCEL_NOTICE_MINUTES} minutes in advance.`,
    )
  }

  booking.status = BOOKING_STATUS.CANCELLED
  booking.cancelledAt = now
  booking.cancelledBy = role
  booking.cancellationReason = reason
  // Releasing the slot key frees the slot for other clients.
  booking.set('slotKey', undefined)
  await booking.save()

  logger.info({ bookingId: booking.id, cancelledBy: role }, 'Booking cancelled')

  await dispatchBookingCancelled(booking, role)

  return getBookingForActor(actor, booking.id)
}

export async function rescheduleBooking(
  actor: Actor,
  bookingId: string,
  input: RescheduleBookingInput,
): Promise<BookingDocument> {
  const booking = await Booking.findById(bookingId)
  if (!booking) {
    throw new NotFoundError('Booking not found.')
  }
  const role = assertParticipant(actor, booking)

  if (!isActive(booking)) {
    throw new ConflictError('This booking can no longer be rescheduled.')
  }
  if (booking.startAt <= new Date()) {
    throw new ConflictError('This consultation has already started.')
  }
  if (booking.rescheduleCount >= BOOKING_LIMITS.RESCHEDULE_MAX) {
    throw new ConflictError(
      `A booking can be rescheduled at most ${BOOKING_LIMITS.RESCHEDULE_MAX} times.`,
    )
  }
  if (input.startAt.getTime() === booking.startAt.getTime()) {
    throw new BadRequestError('Pick a different time to reschedule to.')
  }

  const hrUserId = idOf(booking.hrUserId)
  const availability = await getAvailabilityForHr(hrUserId)
  if (!isOfferedSlot(availability, input.startAt)) {
    throw new SlotUnavailableError('That time is not offered by this consultant.')
  }

  const startAt = input.startAt
  const endAt = addMinutes(startAt, availability.slotDurationMinutes)

  await assertClientIsFree(idOf(booking.userId), startAt, endAt, booking.id)
  await assertConsultantIsFree(hrUserId, startAt, endAt, booking.id)

  const previousStartAt = booking.startAt
  const moved = await Booking.findOneAndUpdate(
    { _id: booking._id, status: { $in: ACTIVE_BOOKING_STATUSES } },
    {
      $set: {
        startAt,
        endAt,
        durationMinutes: availability.slotDurationMinutes,
        hrTimezone: availability.timezone,
        userTimezone: input.timezone ?? booking.userTimezone,
        slotKey: buildSlotKey(booking.hrUserId, startAt),
        previousStartAt,
      },
      $inc: { rescheduleCount: 1 },
    },
    { returnDocument: 'after', runValidators: true },
  ).catch(rethrowDuplicateSlot)

  if (!moved) {
    throw new ConflictError('This booking can no longer be rescheduled.')
  }

  logger.info(
    {
      bookingId: moved.id,
      rescheduledBy: role,
      from: previousStartAt.toISOString(),
      to: startAt.toISOString(),
    },
    'Booking rescheduled',
  )

  await dispatchBookingRescheduled(moved, previousStartAt)

  return getBookingForActor(actor, moved.id)
}

/** Participant-triggered repair for a conference the provider refused to create earlier. */
export async function retryBookingMeeting(
  actor: Actor,
  bookingId: string,
): Promise<BookingDocument> {
  const booking = await Booking.findById(bookingId)
  if (!booking) {
    throw new NotFoundError('Booking not found.')
  }
  assertParticipant(actor, booking)

  const meeting = await getMeetingForBooking(booking.id)
  if (!isRetryable(meeting, booking)) {
    throw new ConflictError('This meeting does not need to be created again.')
  }

  await ensureMeetingForBooking(booking.id)

  return getBookingForActor(actor, booking.id)
}

/** Booking DTO with its conference attached — the shape every booking endpoint returns. */
export async function toBookingDetail(booking: BookingDocument): Promise<Record<string, unknown>> {
  return toBookingResponse(booking, await getMeetingForBooking(booking.id))
}

export async function toBookingList(
  bookings: BookingDocument[],
): Promise<Record<string, unknown>[]> {
  const meetings = await getMeetingsForBookings(bookings.map((booking) => booking._id as never))
  return bookings.map((booking) => toBookingResponse(booking, meetings.get(booking.id) ?? null))
}

export function toBookingResponse(
  booking: BookingDocument,
  meeting: MeetingDocument | null = null,
): Record<string, unknown> {
  const client = asPopulatedUser(booking.userId)
  const consultant = asPopulatedUser(booking.hrUserId)
  const profile = booking.hrProfileId as unknown as { id?: string; headline?: string } | null

  return {
    id: booking.id,
    startAt: booking.startAt,
    endAt: booking.endAt,
    durationMinutes: booking.durationMinutes,
    status: booking.status,
    hrTimezone: booking.hrTimezone,
    userTimezone: booking.userTimezone,
    priceCents: booking.priceCents,
    currency: booking.currency,
    meetingProvider: booking.meetingProvider,
    notes: booking.notes ?? undefined,
    cancelledAt: booking.cancelledAt ?? undefined,
    cancelledBy: booking.cancelledBy ?? undefined,
    cancellationReason: booking.cancellationReason ?? undefined,
    previousStartAt: booking.previousStartAt ?? undefined,
    rescheduleCount: booking.rescheduleCount,
    client: client
      ? { id: client.id, firstName: client.firstName, lastName: client.lastName }
      : undefined,
    consultant: consultant
      ? { id: consultant.id, firstName: consultant.firstName, lastName: consultant.lastName }
      : undefined,
    profile: profile && profile.id ? { id: profile.id, headline: profile.headline } : undefined,
    meeting: toMeetingResponse(meeting, booking.meetingProvider),
    canRetryMeeting: isRetryable(meeting, booking),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  }
}

interface InsertBookingArgs {
  actor: Actor
  availability: AvailabilityDocument
  profileId: string
  hrUserId: string
  startAt: Date
  endAt: Date
  input: CreateBookingInput
  priceCents: number
  currency: Currency
}

/**
 * Double-booking protection, in layers:
 *  1. `slotKey` carries a sparse unique index, so two identical starts can never both persist.
 *  2. A post-insert overlap sweep catches partially overlapping races (possible when the
 *     consultant changed slot duration); the booking created last stands down.
 * MongoDB here may run standalone, so this avoids relying on multi-document transactions.
 */
async function insertBooking(args: InsertBookingArgs): Promise<BookingDocument> {
  const booking = await Booking.create({
    userId: args.actor.id,
    hrUserId: args.hrUserId,
    hrProfileId: args.profileId,
    startAt: args.startAt,
    endAt: args.endAt,
    durationMinutes: args.availability.slotDurationMinutes,
    hrTimezone: args.availability.timezone,
    userTimezone: args.input.timezone ?? args.availability.timezone,
    status: BOOKING_STATUS.CONFIRMED,
    priceCents: args.priceCents,
    currency: args.currency,
    meetingProvider: args.input.meetingProvider,
    notes: args.input.notes,
    slotKey: buildSlotKey(args.hrUserId, args.startAt),
  }).catch(rethrowDuplicateSlot)

  const conflict = await findOverlappingBooking(
    { hrUserId: args.hrUserId },
    args.startAt,
    args.endAt,
    booking.id,
  )

  if (conflict && String(conflict._id) < String(booking._id)) {
    await Booking.deleteOne({ _id: booking._id })
    throw new SlotUnavailableError()
  }

  return booking
}

async function assertConsultantIsFree(
  hrUserId: string,
  startAt: Date,
  endAt: Date,
  excludeBookingId?: string,
): Promise<void> {
  const conflict = await findOverlappingBooking({ hrUserId }, startAt, endAt, excludeBookingId)
  if (conflict) {
    throw new SlotUnavailableError()
  }
}

async function assertClientIsFree(
  userId: string,
  startAt: Date,
  endAt: Date,
  excludeBookingId?: string,
): Promise<void> {
  const conflict = await findOverlappingBooking({ userId }, startAt, endAt, excludeBookingId)
  if (conflict) {
    throw new ConflictError('You already have a consultation booked at that time.')
  }
}

async function findOverlappingBooking(
  owner: { hrUserId: string } | { userId: string },
  startAt: Date,
  endAt: Date,
  excludeBookingId?: string,
): Promise<BookingDocument | null> {
  const filter: Record<string, unknown> = {
    ...owner,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  }
  if (excludeBookingId) {
    filter._id = { $ne: new mongoose.Types.ObjectId(excludeBookingId) }
  }
  return Booking.findOne(filter)
}

function assertParticipant(actor: Actor, booking: BookingDocument): CancelledBy {
  if (idOf(booking.userId) === actor.id) {
    return CANCELLED_BY.USER
  }
  if (idOf(booking.hrUserId) === actor.id) {
    return CANCELLED_BY.HR
  }
  if (actor.role === USER_ROLES.ADMIN || actor.role === USER_ROLES.SUPER_ADMIN) {
    return CANCELLED_BY.ADMIN
  }
  throw new NotFoundError('Booking not found.')
}

function resolveScopeRole(actor: Actor, requested?: 'user' | 'hr'): 'user' | 'hr' {
  if (!requested) {
    return actor.role === USER_ROLES.HR ? 'hr' : 'user'
  }
  if (requested === 'hr' && actor.role !== USER_ROLES.HR) {
    throw new ForbiddenError('Only consultants can list bookings made with them.')
  }
  return requested
}

function isActive(booking: BookingDocument): boolean {
  return ACTIVE_BOOKING_STATUSES.includes(booking.status)
}

function prorate(hourlyRateCents: number, durationMinutes: number): number {
  return Math.round((hourlyRateCents * durationMinutes) / 60)
}

/** Reference ids read the same whether or not the path was populated. */
function idOf(value: unknown): string {
  if (value && typeof value === 'object' && '_id' in value) {
    return String((value as { _id: unknown })._id)
  }
  return String(value)
}

function asPopulatedUser(value: unknown): PopulatedUser | null {
  const user = value as PopulatedUser | null
  return user && typeof user === 'object' && 'firstName' in user ? user : null
}

function rethrowDuplicateSlot(err: unknown): never {
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === DUPLICATE_KEY
  ) {
    throw new SlotUnavailableError()
  }
  throw err
}

async function dispatchBookingCreated(booking: BookingDocument): Promise<void> {
  const meetingQueue = getMeetingQueue()
  await meetingQueue.add('create', { bookingId: booking.id as string })

  scheduleReminder(booking.id as string, booking.startAt)
  await enqueueBookingEmails(booking, 'confirmation')
}

async function dispatchBookingCancelled(
  booking: BookingDocument,
  cancelledBy: CancelledBy,
): Promise<void> {
  const meetingQueue = getMeetingQueue()
  await meetingQueue.add('cancel', { bookingId: booking.id as string })

  removeReminder(booking.id as string)
  await enqueueBookingEmails(booking, 'cancellation', { cancelledBy })
}

async function dispatchBookingRescheduled(
  booking: BookingDocument,
  previousStartAt: Date,
): Promise<void> {
  const meetingQueue = getMeetingQueue()
  await meetingQueue.add('sync', { bookingId: booking.id as string })

  removeReminder(booking.id as string)
  scheduleReminder(booking.id as string, booking.startAt)
  await enqueueBookingEmails(booking, 'reschedule', { previousStartAt })
}

function scheduleReminder(bookingId: string, startAt: Date): void {
  const delay = startAt.getTime() - REMINDER_LEAD_MS - Date.now()
  if (delay <= 0) return

  getReminderQueue()
    .add('remind', { bookingId }, { jobId: reminderJobId(bookingId), delay })
    .catch((err) => {
      logger.warn(
        { bookingId, err: err instanceof Error ? err.message : err },
        'Failed to schedule reminder',
      )
    })
}

function removeReminder(bookingId: string): void {
  getReminderQueue()
    .remove(reminderJobId(bookingId))
    .catch(() => {
      /* Best effort — the job may have already fired or never existed. */
    })
}

type EmailKind = 'confirmation' | 'cancellation' | 'reschedule'

interface EmailExtras {
  cancelledBy?: CancelledBy
  previousStartAt?: Date
}

async function enqueueBookingEmails(
  booking: BookingDocument,
  kind: EmailKind,
  extras?: EmailExtras,
): Promise<void> {
  try {
    const users = await User.find({
      _id: { $in: [booking.userId, booking.hrUserId] },
    }).select('email firstName lastName')

    const client = users.find((u) => String(u._id) === String(booking.userId))
    const consultant = users.find((u) => String(u._id) === String(booking.hrUserId))
    if (!client || !consultant) return

    const base = {
      bookingId: booking.id as string,
      startAt: booking.startAt,
      durationMinutes: booking.durationMinutes,
      priceCents: booking.priceCents,
      currency: booking.currency,
    }

    const pairs: { email: string; name: string; counterpart: string; timezone: string }[] = [
      {
        email: client.email,
        name: client.firstName,
        counterpart: `${consultant.firstName} ${consultant.lastName}`.trim(),
        timezone: booking.userTimezone,
      },
      {
        email: consultant.email,
        name: consultant.firstName,
        counterpart: `${client.firstName} ${client.lastName}`.trim(),
        timezone: booking.hrTimezone,
      },
    ]

    for (const p of pairs) {
      const ctx = {
        ...base,
        recipientName: p.name,
        counterpartName: p.counterpart,
        recipientTimezone: p.timezone,
      }

      let built: { subject: string; html: string }
      switch (kind) {
        case 'confirmation':
          built = buildBookingConfirmation(ctx)
          break
        case 'cancellation':
          built = buildBookingCancellation({
            ...ctx,
            cancelledBy: extras?.cancelledBy ?? 'SYSTEM',
            reason: booking.cancellationReason,
          })
          break
        case 'reschedule':
          built = buildBookingReschedule({
            ...ctx,
            previousStartAt: extras?.previousStartAt ?? booking.startAt,
          })
          break
      }

      enqueueEmail({ to: p.email, ...built })
    }
  } catch (err) {
    logger.warn(
      { bookingId: booking.id, err: err instanceof Error ? err.message : err },
      'Failed to enqueue booking emails',
    )
  }
}
