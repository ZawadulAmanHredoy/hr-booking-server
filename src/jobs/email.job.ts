import { Worker, type Job } from 'bullmq'
import { getQueueConnection, getQueuePrefix } from '../queues/connection.js'
import { EMAIL_QUEUE_NAME } from '../queues/email.queue.js'
import { getEmailTransport } from '../services/email/index.js'
import { logger } from '../config/logger.js'
import type { EmailMessage } from '../services/email/email.service.js'

export function createEmailWorker(): Worker<EmailMessage> {
  const worker = new Worker<EmailMessage>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailMessage>) => {
      await getEmailTransport().send(job.data)
      logger.debug({ to: job.data.to, subject: job.data.subject }, 'Email job delivered')
    },
    { connection: getQueueConnection(), prefix: getQueuePrefix(), concurrency: 5 },
  )

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, to: job?.data.to, err: err.message }, 'Email job failed')
  })

  return worker
}
