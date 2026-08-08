import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../../../config/env.js'
import { logger } from '../../../config/logger.js'
import type { EmailMessage, EmailTransport } from '../email.service.js'

export class SmtpTransport implements EmailTransport {
  readonly name = 'smtp'
  private readonly transporter: Transporter

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth:
        env.SMTP_USER && env.SMTP_PASSWORD
          ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
          : undefined,
    })
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    logger.info({ to: message.to, subject: message.subject }, 'Email sent via SMTP')
  }
}
