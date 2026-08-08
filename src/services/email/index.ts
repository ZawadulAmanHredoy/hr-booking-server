import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import type { EmailMessage, EmailTransport } from './email.service.js'
import { ConsoleTransport } from './transports/console.transport.js'
import { SmtpTransport } from './transports/smtp.transport.js'
import { getEmailQueue } from '../../queues/email.queue.js'

export type { EmailMessage }

let transport: EmailTransport | null = null

export function getEmailTransport(): EmailTransport {
  if (!transport) {
    transport = env.EMAIL_TRANSPORT === 'smtp' ? new SmtpTransport() : new ConsoleTransport()
  }
  return transport
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  try {
    await getEmailTransport().send(message)
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, to: message.to, subject: message.subject },
      'Failed to send email',
    )
  }
}

export function enqueueEmail(message: EmailMessage): void {
  getEmailQueue()
    .add('send', message)
    .catch((err) => {
      logger.error(
        { err: err instanceof Error ? err.message : err, to: message.to, subject: message.subject },
        'Failed to enqueue email',
      )
    })
}
