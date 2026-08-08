import { Worker, type Job } from 'bullmq'
import { getQueueConnection, getQueuePrefix } from '../queues/connection.js'
import { REMINDER_QUEUE_NAME, type ReminderJobData } from '../queues/reminder.queue.js'
import { ACTIVE_BOOKING_STATUSES } from '../config/constants.js'
import { logger } from '../config/logger.js'
import { Booking } from '../models/Booking.js'
import { User } from '../models/User.js'
import { getMeetingForBooking } from '../services/meeting.service.js'
import { buildBookingReminder } from '../services/email/templates/booking.templates.js'
import { enqueueEmail } from '../services/email/index.js'

export function createReminderWorker(): Worker<ReminderJobData> {
  const worker = new Worker<ReminderJobData>(
    REMINDER_QUEUE_NAME,
    async (job: Job<ReminderJobData>) => {
      const { bookingId } = job.data
      const booking = await Booking.findById(bookingId)

      if (!booking) {
        logger.debug({ bookingId }, 'Reminder skipped — booking not found')
        return
      }

      if (
        !ACTIVE_BOOKING_STATUSES.includes(booking.status) ||
        booking.endAt.getTime() <= Date.now()
      ) {
        logger.debug(
          { bookingId, status: booking.status },
          'Reminder skipped — booking inactive or past',
        )
        return
      }

      const [users, meeting] = await Promise.all([
        User.find({ _id: { $in: [booking.userId, booking.hrUserId] } }).select(
          'email firstName lastName',
        ),
        getMeetingForBooking(bookingId),
      ])

      const client = users.find((u) => String(u._id) === String(booking.userId))
      const consultant = users.find((u) => String(u._id) === String(booking.hrUserId))

      if (!client || !consultant) {
        logger.warn({ bookingId }, 'Reminder skipped — participants not found')
        return
      }

      const meetingUrl = meeting?.meetingUrl ?? undefined
      const base = {
        bookingId: booking.id as string,
        startAt: booking.startAt,
        durationMinutes: booking.durationMinutes,
        priceCents: booking.priceCents,
        currency: booking.currency,
        meetingUrl,
      }

      const clientEmail = buildBookingReminder({
        ...base,
        recipientName: client.firstName,
        counterpartName: `${consultant.firstName} ${consultant.lastName}`.trim(),
        recipientTimezone: booking.userTimezone,
      })
      enqueueEmail({ to: client.email, ...clientEmail })

      const consultantEmail = buildBookingReminder({
        ...base,
        recipientName: consultant.firstName,
        counterpartName: `${client.firstName} ${client.lastName}`.trim(),
        recipientTimezone: booking.hrTimezone,
      })
      enqueueEmail({ to: consultant.email, ...consultantEmail })

      logger.info({ bookingId }, 'Reminder emails enqueued for both participants')
    },
    { connection: getQueueConnection(), prefix: getQueuePrefix(), concurrency: 5 },
  )

  worker.on('failed', (job, err) => {
    logger.warn(
      { jobId: job?.id, bookingId: job?.data.bookingId, err: err.message },
      'Reminder job failed',
    )
  })

  return worker
}
