import { z } from 'zod'
import { AUTH_LIMITS, CURRENCIES, PROFILE_LIMITS } from '../config/constants.js'
import { specializationEnum, workHistoryEntrySchema } from './hrProfile.validator.js'

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

export const registerHrSchema = registerSchema.extend({
  phone: z.string().trim().min(6).max(20),
  profileImageUrl: z.url('Invalid image URL').optional(),
  headline: z.string().trim().min(2).max(80),
  bio: z.string().trim().min(10).max(2000),
  specializations: z
    .array(specializationEnum)
    .min(PROFILE_LIMITS.SPECIALIZATIONS_MIN)
    .max(PROFILE_LIMITS.SPECIALIZATIONS_MAX),
  yearsOfExperience: z.coerce.number().int().min(0).max(70),
  companyName: z.string().trim().min(1).max(150),
  hourlyRateCents: z.coerce
    .number()
    .int()
    .min(PROFILE_LIMITS.HOURLY_RATE_CENTS_MIN)
    .max(PROFILE_LIMITS.HOURLY_RATE_CENTS_MAX),
  currency: z.enum(CURRENCIES).default('USD'),
  languages: z
    .array(z.string().trim().min(1).max(30))
    .min(PROFILE_LIMITS.LANGUAGES_MIN)
    .max(PROFILE_LIMITS.LANGUAGES_MAX),
  city: z.string().trim().min(1).max(100).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  workHistory: z.array(workHistoryEntrySchema).min(1).max(PROFILE_LIMITS.WORK_HISTORY_MAX),
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
export type RegisterHrInput = z.infer<typeof registerHrSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
