import { z } from 'zod'
import { AUTH_LIMITS } from '../config/constants.js'

const passwordSchema = z
  .string()
  .min(
    AUTH_LIMITS.PASSWORD_MIN_LENGTH,
    `Password must be at least ${AUTH_LIMITS.PASSWORD_MIN_LENGTH} characters`,
  )
  .max(AUTH_LIMITS.PASSWORD_MAX_LENGTH)
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number')

export const registerSchema = z.object({
  email: z.email('A valid email is required').toLowerCase(),
  password: passwordSchema,
  firstName: z.string().trim().min(2).max(50),
  lastName: z.string().trim().min(2).max(50),
})

export const loginSchema = z.object({
  email: z.email('A valid email is required').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
})

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
})

export const forgotPasswordSchema = z.object({
  email: z.email('A valid email is required').toLowerCase(),
})

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
