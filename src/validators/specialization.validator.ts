import { z } from 'zod'
import { SPECIALIZATION_LIMITS } from '../config/constants.js'

export const specializationIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid specialization id'),
})

export const createSpecializationSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Use letters, numbers and underscores only')
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(SPECIALIZATION_LIMITS.NAME_MAX),
  description: z.string().trim().max(SPECIALIZATION_LIMITS.DESCRIPTION_MAX).optional(),
})

export const updateSpecializationSchema = z
  .object({
    name: z.string().trim().min(2).max(SPECIALIZATION_LIMITS.NAME_MAX).optional(),
    description: z.string().trim().max(SPECIALIZATION_LIMITS.DESCRIPTION_MAX).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update.')

export type CreateSpecializationInput = z.infer<typeof createSpecializationSchema>
export type UpdateSpecializationInput = z.infer<typeof updateSpecializationSchema>
