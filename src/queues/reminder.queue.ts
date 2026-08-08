import { Queue } from 'bullmq'
import { getQueueConnection, getQueuePrefix } from './connection.js'

export const REMINDER_QUEUE_NAME = 'reminder'

export interface ReminderJobData {
  bookingId: string
}

export const REMINDER_LEAD_MS = 30 * 60 * 1000

let queue: Queue<ReminderJobData> | null = null

export function getReminderQueue(): Queue<ReminderJobData> {
  if (!queue) {
    queue = new Queue<ReminderJobData>(REMINDER_QUEUE_NAME, {
      connection: getQueueConnection(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    })
  }
  return queue
}

/**
 * Deterministic id so re-scheduling a reminder replaces the previous one. BullMQ rejects `:`
 * in custom job ids (it is the key separator), so the separator here must not be a colon.
 */
export function reminderJobId(bookingId: string): string {
  return `reminder-${bookingId}`
}
