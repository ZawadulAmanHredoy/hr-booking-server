import { z } from 'zod'
import { CURRENCIES, PROFILE_LIMITS } from '../config/constants.js'

// Specialization slugs are admin-managed (see `Specialization` model); the shape here is just a
// non-empty string, and validity/activeness is checked against the DB in the service layer.
export const specializationSlugSchema = z.string().trim().min(1).max(60)

export const workHistoryEntrySchema = z.object({
  company: z.string().trim().min(1).max(150),
  role: z.string().trim().min(1).max(150),
  startYear: z.coerce.number().int().min(1950).max(2100),
  endYear: z.coerce.number().int().min(1950).max(2100).optional(),
  description: z.string().trim().max(300).optional(),
})

export const upsertProfileSchema = z.object({
  headline: z.string().trim().min(2).max(80),
  bio: z.string().trim().min(10).max(2000),
  specializations: z
    .array(specializationSlugSchema)
    .min(PROFILE_LIMITS.SPECIALIZATIONS_MIN)
    .max(PROFILE_LIMITS.SPECIALIZATIONS_MAX),
  yearsOfExperience: z.coerce.number().int().min(0).max(70),
  companyName: z.string().trim().min(1).max(150).optional(),
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
  profileImageUrl: z.url('Invalid image URL').optional(),
  certifications: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        issuer: z.string().trim().min(1).max(100).optional(),
        year: z.coerce.number().int().min(1950).max(2100).optional(),
      }),
    )
    .max(PROFILE_LIMITS.CERTIFICATIONS_MAX)
    .optional(),
  workHistory: z.array(workHistoryEntrySchema).max(PROFILE_LIMITS.WORK_HISTORY_MAX).optional(),
})

export const availabilitySchema = z.object({
  isAvailable: z.boolean(),
})

export const profileIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid profile id'),
})

export const listProfilesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  search: z.string().trim().min(1).max(100).optional(),
  specialization: specializationSlugSchema.optional(),
  language: z.string().trim().min(1).max(30).optional(),
  minRateCents: z.coerce.number().int().min(0).optional(),
  maxRateCents: z.coerce.number().int().min(0).optional(),
  sortBy: z.enum(['rating', 'hourlyRateCents', 'newest']).default('rating'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>
export type ListProfilesQuery = z.infer<typeof listProfilesQuerySchema>
