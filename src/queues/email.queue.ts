import { Queue } from 'bullmq'
import { getQueueConnection, getQueuePrefix } from './connection.js'
import type { EmailMessage } from '../services/email/email.service.js'

export const EMAIL_QUEUE_NAME = 'email'

let queue: Queue<EmailMessage> | null = null

export function getEmailQueue(): Queue<EmailMessage> {
  if (!queue) {
    queue = new Queue<EmailMessage>(EMAIL_QUEUE_NAME, {
      connection: getQueueConnection(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    })
  }
  return queue
}
