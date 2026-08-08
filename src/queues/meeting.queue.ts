import { Queue } from 'bullmq'
import { getQueueConnection, getQueuePrefix } from './connection.js'

export const MEETING_QUEUE_NAME = 'meeting'

export interface MeetingJobData {
  bookingId: string
}

export type MeetingJobName = 'create' | 'sync' | 'cancel'

let queue: Queue<MeetingJobData, void, MeetingJobName> | null = null

export function getMeetingQueue(): Queue<MeetingJobData, void, MeetingJobName> {
  if (!queue) {
    queue = new Queue<MeetingJobData, void, MeetingJobName>(MEETING_QUEUE_NAME, {
      connection: getQueueConnection(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    })
  }
  return queue
}
