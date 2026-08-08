import { Queue, Worker } from 'bullmq'
import { getQueueConnection, getQueuePrefix } from '../queues/connection.js'
import { BOOKING_STATUS, ACTIVE_BOOKING_STATUSES } from '../config/constants.js'
import { logger } from '../config/logger.js'
import { Booking } from '../models/Booking.js'

export const LIFECYCLE_QUEUE_NAME = 'booking-lifecycle'

const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const LIFECYCLE_JOB_ID = 'lifecycle-sweep'

let queue: Queue | null = null

export function getLifecycleQueue(): Queue {
  if (!queue) {
    queue = new Queue(LIFECYCLE_QUEUE_NAME, {
      connection: getQueueConnection(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    })
  }
  return queue
}

export function createLifecycleWorker(): Worker {
  const worker = new Worker(
    LIFECYCLE_QUEUE_NAME,
    async () => {
      const now = new Date()
      const result = await Booking.updateMany(
        {
          status: { $in: ACTIVE_BOOKING_STATUSES },
          endAt: { $lte: now },
        },
        { $set: { status: BOOKING_STATUS.COMPLETED }, $unset: { slotKey: 1 } },
      )

      if (result.modifiedCount > 0) {
        logger.info(
          { count: result.modifiedCount },
          'Booking lifecycle sweep: marked bookings as COMPLETED',
        )
      }
    },
    { connection: getQueueConnection(), prefix: getQueuePrefix(), concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, 'Lifecycle sweep failed')
  })

  return worker
}

export async function scheduleLifecycleSweep(): Promise<void> {
  const q = getLifecycleQueue()
  await q.upsertJobScheduler(LIFECYCLE_JOB_ID, { every: SWEEP_INTERVAL_MS }, { name: 'sweep' })
  logger.info({ intervalMs: SWEEP_INTERVAL_MS }, 'Booking lifecycle sweeper scheduled')
}
