import { env } from '../../../config/env.js'

interface TemplateContext {
  firstName: string
  token: string
}

export function buildVerifyEmail(ctx: TemplateContext): { subject: string; html: string } {
  const url = `${env.CLIENT_URL}/verify-email?token=${encodeURIComponent(ctx.token)}`
  return {
    subject: 'Verify your email address',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1f2937;">Hi ${escapeHtml(ctx.firstName)},</h2>
        <p>Welcome to HR Booking. Please confirm your email address to activate your account.</p>
        <p><a href="${url}" style="display:inline-block; background:#2563eb; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none;">Verify email</a></p>
        <p style="color:#6b7280; font-size:13px;">If the button does not work, copy this link into your browser:<br/>${url}</p>
        <p style="color:#6b7280; font-size:13px;">This link expires in 24 hours.</p>
      </div>`,
  }
}

export function buildResetPasswordEmail(ctx: TemplateContext): { subject: string; html: string } {
  const url = `${env.CLIENT_URL}/reset-password?token=${encodeURIComponent(ctx.token)}`
  return {
    subject: 'Reset your password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1f2937;">Hi ${escapeHtml(ctx.firstName)},</h2>
        <p>We received a request to reset your password. Click below to choose a new one.</p>
        <p><a href="${url}" style="display:inline-block; background:#2563eb; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none;">Reset password</a></p>
        <p style="color:#6b7280; font-size:13px;">If the button does not work, copy this link into your browser:<br/>${url}</p>
        <p style="color:#6b7280; font-size:13px;">This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>
      </div>`,
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
