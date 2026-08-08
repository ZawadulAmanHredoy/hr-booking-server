import { logger } from '../../../config/logger.js'
import type { EmailMessage, EmailTransport } from '../email.service.js'

export class ConsoleTransport implements EmailTransport {
  readonly name = 'console'

  async send(message: EmailMessage): Promise<void> {
    logger.info(
      {
        to: message.to,
        subject: message.subject,
        html: message.html,
      },
      'Email captured by console transport',
    )
  }
}
