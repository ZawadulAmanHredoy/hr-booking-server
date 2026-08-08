import { DateTime } from 'luxon'
import { env } from '../../../config/env.js'

interface BookingContext {
  bookingId: string
  recipientName: string
  counterpartName: string
  startAt: Date
  durationMinutes: number
  priceCents: number
  currency: string
  recipientTimezone: string
  meetingUrl?: string
}

interface CancelContext extends BookingContext {
  cancelledBy: string
  reason?: string
}

interface RescheduleContext extends BookingContext {
  previousStartAt: Date
}

export function buildBookingConfirmation(ctx: BookingContext): { subject: string; html: string } {
  const when = formatInZone(ctx.startAt, ctx.recipientTimezone)
  const fee = formatCents(ctx.priceCents, ctx.currency)
  const viewUrl = bookingUrl(ctx.bookingId)

  return {
    subject: `Booking confirmed — ${when}`,
    html: layout(
      `Hi ${esc(ctx.recipientName)},`,
      `
        <p>Your consultation with <strong>${esc(ctx.counterpartName)}</strong> is confirmed.</p>
        ${detailsTable(when, ctx.durationMinutes, fee, ctx.recipientTimezone)}
        ${meetingBlock(ctx.meetingUrl)}
        ${ctaButton(viewUrl, 'View booking')}
      `,
    ),
  }
}

export function buildBookingCancellation(ctx: CancelContext): { subject: string; html: string } {
  const when = formatInZone(ctx.startAt, ctx.recipientTimezone)

  return {
    subject: `Booking cancelled — ${when}`,
    html: layout(
      `Hi ${esc(ctx.recipientName)},`,
      `
        <p>The consultation with <strong>${esc(ctx.counterpartName)}</strong> on ${when} has been cancelled${ctx.cancelledBy ? ` by the ${esc(ctx.cancelledBy.toLowerCase())}` : ''}.</p>
        ${ctx.reason ? `<p style="color:#6b7280;font-size:13px;">Reason: ${esc(ctx.reason)}</p>` : ''}
        ${ctaButton(bookingUrl(ctx.bookingId), 'View details')}
      `,
    ),
  }
}

export function buildBookingReschedule(ctx: RescheduleContext): { subject: string; html: string } {
  const oldWhen = formatInZone(ctx.previousStartAt, ctx.recipientTimezone)
  const newWhen = formatInZone(ctx.startAt, ctx.recipientTimezone)
  const fee = formatCents(ctx.priceCents, ctx.currency)

  return {
    subject: `Booking rescheduled — ${newWhen}`,
    html: layout(
      `Hi ${esc(ctx.recipientName)},`,
      `
        <p>Your consultation with <strong>${esc(ctx.counterpartName)}</strong> has been moved.</p>
        <table style="border-collapse:collapse;margin:12px 0;">
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Was</td><td style="padding:4px 0;text-decoration:line-through;color:#9ca3af;">${oldWhen}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Now</td><td style="padding:4px 0;font-weight:600;">${newWhen}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Duration</td><td style="padding:4px 0;">${ctx.durationMinutes} min</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Fee</td><td style="padding:4px 0;">${fee}</td></tr>
        </table>
        ${meetingBlock(ctx.meetingUrl)}
        ${ctaButton(bookingUrl(ctx.bookingId), 'View booking')}
      `,
    ),
  }
}

export function buildBookingReminder(ctx: BookingContext): { subject: string; html: string } {
  const when = formatInZone(ctx.startAt, ctx.recipientTimezone)

  return {
    subject: `Reminder: consultation in 30 minutes — ${when}`,
    html: layout(
      `Hi ${esc(ctx.recipientName)},`,
      `
        <p>Your consultation with <strong>${esc(ctx.counterpartName)}</strong> starts in <strong>30 minutes</strong>.</p>
        ${detailsTable(when, ctx.durationMinutes, formatCents(ctx.priceCents, ctx.currency), ctx.recipientTimezone)}
        ${meetingBlock(ctx.meetingUrl)}
        ${ctaButton(bookingUrl(ctx.bookingId), 'View booking')}
      `,
    ),
  }
}

function layout(greeting: string, body: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="color:#1f2937;">${greeting}</h2>
      ${body}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;" />
      <p style="color:#9ca3af;font-size:12px;">HR Booking · You received this because you have a booking on our platform.</p>
    </div>`
}

function detailsTable(when: string, duration: number, fee: string, timezone: string): string {
  return `
    <table style="border-collapse:collapse;margin:12px 0;">
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">When</td><td style="padding:4px 0;">${when}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Timezone</td><td style="padding:4px 0;">${esc(timezone)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Duration</td><td style="padding:4px 0;">${duration} min</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Fee</td><td style="padding:4px 0;">${fee}</td></tr>
    </table>`
}

function meetingBlock(meetingUrl?: string): string {
  if (!meetingUrl) return ''
  return `
    <p style="margin:12px 0;">
      <a href="${meetingUrl}" style="display:inline-block;background:#059669;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Join meeting</a>
    </p>
    <p style="color:#6b7280;font-size:13px;">Or paste this link: ${meetingUrl}</p>`
}

function ctaButton(url: string, label: string): string {
  return `
    <p style="margin:16px 0;">
      <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">${label}</a>
    </p>`
}

function bookingUrl(bookingId: string): string {
  return `${env.CLIENT_URL}/dashboard/bookings/${bookingId}`
}

function formatInZone(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: timezone }).toFormat('EEE d LLL yyyy, HH:mm')
}

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
