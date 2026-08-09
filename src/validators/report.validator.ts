import { z } from 'zod'
import {
  ADMIN_LIMITS,
  REPORT_REASONS,
  REPORT_STATUS,
  type ReportReason,
} from '../config/constants.js'

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id')

export const createReportSchema = z.object({
  hrProfileId: objectIdSchema,
  reason: z.enum(Object.values(REPORT_REASONS) as [ReportReason, ...ReportReason[]]),
  details: z.string().trim().max(ADMIN_LIMITS.REPORT_DETAILS_MAX).optional(),
})

export const reportIdParamsSchema = z.object({
  id: objectIdSchema,
})

export const resolveReportSchema = z.object({
  status: z.enum([REPORT_STATUS.DISMISSED, REPORT_STATUS.ACTIONED]),
  notes: z.string().trim().max(ADMIN_LIMITS.RESOLUTION_NOTES_MAX).optional(),
})

export const listReportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_LIMITS.PAGE_SIZE_MAX)
    .default(ADMIN_LIMITS.PAGE_SIZE_DEFAULT),
  status: z.enum(Object.values(REPORT_STATUS) as [string, ...string[]]).optional(),
})

export type CreateReportInput = z.infer<typeof createReportSchema>
export type ResolveReportInput = z.infer<typeof resolveReportSchema>
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>
