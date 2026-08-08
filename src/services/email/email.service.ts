export interface EmailMessage {
  to: string
  subject: string
  html: string
  text?: string
}

export interface EmailTransport {
  readonly name: string
  send(message: EmailMessage): Promise<void>
}
