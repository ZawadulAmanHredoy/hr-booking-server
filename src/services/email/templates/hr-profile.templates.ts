import { env } from '../../../config/env.js'

function layout(greeting: string, body: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="color:#1f2937;">${greeting}</h2>
      ${body}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;" />
      <p style="color:#9ca3af;font-size:12px;">HR Booking · You received this because you have a consultant profile on our platform.</p>
    </div>`
}

function ctaButton(url: string, label: string): string {
  return `
    <p style="margin:16px 0;">
      <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">${label}</a>
    </p>`
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function buildProfileApproved(name: string): { subject: string; html: string } {
  return {
    subject: 'Your HR consultant profile has been approved',
    html: layout(
      `Hi ${esc(name)},`,
      `
        <p>We're pleased to let you know that your HR consultant profile has been reviewed and approved. It is now live in our public directory and ready to accept consultation bookings.</p>
        <p>Thank you for joining HR Booking — we look forward to helping you connect with clients.</p>
        ${ctaButton(`${env.CLIENT_URL}/profile/manage`, 'View your profile')}
      `,
    ),
  }
}

/** Sent to every ADMIN/SUPER_ADMIN when an HR profile is submitted (or resubmitted) for review. */
export function buildNewApplicationNotice(
  applicantName: string,
  headline: string,
): { subject: string; html: string } {
  return {
    subject: 'New HR application awaiting review',
    html: layout(
      'Hi,',
      `
        <p><strong>${esc(applicantName)}</strong> has submitted an HR consultant application for review.</p>
        <p style="color:#6b7280;font-size:13px;">Headline: ${esc(headline)}</p>
        ${ctaButton(`${env.CLIENT_URL}/admin/hr`, 'Review application')}
      `,
    ),
  }
}

export function buildProfileRejected(
  name: string,
  reason: string,
): { subject: string; html: string } {
  return {
    subject: 'Your HR profile needs changes',
    html: layout(
      `Hi ${esc(name)},`,
      `
        <p>We reviewed your consultant profile and it needs some changes before it can go live.</p>
        <p style="color:#6b7280;font-size:13px;">Reviewer note: ${esc(reason)}</p>
        <p>You can update your profile and resubmit it for review at any time.</p>
        ${ctaButton(`${env.CLIENT_URL}/profile`, 'Edit your profile')}
      `,
    ),
  }
}
