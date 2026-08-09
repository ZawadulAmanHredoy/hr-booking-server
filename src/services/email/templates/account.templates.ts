import { env } from '../../../config/env.js'

function layout(greeting: string, body: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="color:#1f2937;">${greeting}</h2>
      ${body}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;" />
      <p style="color:#9ca3af;font-size:12px;">HR Booking · You received this because of a change to your account.</p>
    </div>`
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function buildAccountSuspended(
  name: string,
  reason: string,
): { subject: string; html: string } {
  return {
    subject: 'Your HR Booking account has been suspended',
    html: layout(
      `Hi ${esc(name)},`,
      `
        <p>Your account has been suspended by an administrator. You will not be able to log in until it is reactivated.</p>
        <p style="color:#6b7280;font-size:13px;">Reason: ${esc(reason)}</p>
        <p>If you believe this was a mistake, reply to this email and we'll take a look.</p>
      `,
    ),
  }
}

export function buildAccountReactivated(name: string): { subject: string; html: string } {
  return {
    subject: 'Your HR Booking account has been reactivated',
    html: layout(
      `Hi ${esc(name)},`,
      `
        <p>Good news — your account has been reactivated. You can log in again right away.</p>
        <p style="margin:16px 0;">
          <a href="${env.CLIENT_URL}/login" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Log in</a>
        </p>
      `,
    ),
  }
}
