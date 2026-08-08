import { Worker, type Job } from 'bullmq'
import { getQueueConnection, getQueuePrefix } from '../queues/connection.js'
import {
  MEETING_QUEUE_NAME,
  type MeetingJobData,
  type MeetingJobName,
} from '../queues/meeting.queue.js'
import {
  ensureMeetingForBooking,
  syncMeetingTimes,
  cancelMeetingForBooking,
} from '../services/meeting.service.js'
import { logger } from '../config/logger.js'

export function createMeetingWorker(): Worker<MeetingJobData, void, MeetingJobName> {
  const worker = new Worker<MeetingJobData, void, MeetingJobName>(
    MEETING_QUEUE_NAME,
    async (job: Job<MeetingJobData, void, MeetingJobName>) => {
      const { bookingId } = job.data

      switch (job.name) {
        case 'create':
          await ensureMeetingForBooking(bookingId)
          break
        case 'sync':
          await syncMeetingTimes(bookingId)
          break
        case 'cancel':
          await cancelMeetingForBooking(bookingId)
          break
        default:
          logger.warn({ jobName: job.name, bookingId }, 'Unknown meeting job name')
      }
    },
    { connection: getQueueConnection(), prefix: getQueuePrefix(), concurrency: 3 },
  )

  worker.on('failed', (job, err) => {
    logger.warn(
      { jobId: job?.id, jobName: job?.name, bookingId: job?.data.bookingId, err: err.message },
      'Meeting job failed',
    )
  })

  return worker
}
