import { HRProfile } from '../models/HRProfile.js'
import { Report, type ReportDocument } from '../models/Report.js'
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, REPORT_STATUS } from '../config/constants.js'
import { BadRequestError, ConflictError, NotFoundError } from '../utils/http-errors.js'
import { recordAuditLog } from './audit-log.service.js'
import type { Pagination } from '../utils/response.js'
import type {
  CreateReportInput,
  ListReportsQuery,
  ResolveReportInput,
} from '../validators/report.validator.js'

export async function createReport(
  actorId: string,
  input: CreateReportInput,
): Promise<ReportDocument> {
  const profile = await HRProfile.findById(input.hrProfileId)
  if (!profile) {
    throw new NotFoundError('Profile not found.')
  }
  if (String(profile.userId) === actorId) {
    throw new BadRequestError('You cannot report your own profile.')
  }

  const existing = await Report.findOne({
    reporterId: actorId,
    hrProfileId: input.hrProfileId,
    status: REPORT_STATUS.PENDING,
  })
  if (existing) {
    throw new ConflictError('You already have a pending report for this profile.')
  }

  return Report.create({
    reporterId: actorId,
    hrProfileId: input.hrProfileId,
    hrUserId: profile.userId,
    reason: input.reason,
    details: input.details,
  })
}

export async function listReports(
  query: ListReportsQuery,
): Promise<{ data: ReportDocument[]; pagination: Pagination }> {
  const filter: Record<string, unknown> = {}
  if (query.status) filter.status = query.status

  const total = await Report.countDocuments(filter)
  const totalPages = Math.max(1, Math.ceil(total / query.limit))
  const page = Math.min(query.page, totalPages)

  const data = await Report.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * query.limit)
    .limit(query.limit)
    .populate('reporterId', 'firstName lastName email')
    .populate('hrProfileId', 'headline')
    .populate('hrUserId', 'firstName lastName email')
    .populate('resolvedBy', 'firstName lastName')

  return { data, pagination: { page, limit: query.limit, total, totalPages } }
}

export async function resolveReport(
  actor: { id: string; role: string },
  reportId: string,
  input: ResolveReportInput,
): Promise<ReportDocument> {
  const report = await Report.findById(reportId)
  if (!report) {
    throw new NotFoundError('Report not found.')
  }
  if (report.status !== REPORT_STATUS.PENDING) {
    throw new ConflictError('This report has already been resolved.')
  }

  report.status = input.status
  report.resolvedBy = actor.id as unknown as typeof report.resolvedBy
  report.resolvedAt = new Date()
  report.resolutionNotes = input.notes
  await report.save()

  await recordAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.REPORT_RESOLVED,
    resourceType: AUDIT_RESOURCE_TYPES.REPORT,
    resourceId: report.id,
    metadata: { status: input.status, hrProfileId: String(report.hrProfileId) },
  })

  return report
}

export function toReportResponse(report: ReportDocument): Record<string, unknown> {
  const reporter = report.reporterId as unknown as {
    id?: string
    firstName?: string
    lastName?: string
    email?: string
  } | null
  const profile = report.hrProfileId as unknown as { id?: string; headline?: string } | null
  const hrUser = report.hrUserId as unknown as {
    id?: string
    firstName?: string
    lastName?: string
    email?: string
  } | null
  const resolver = report.resolvedBy as unknown as {
    id?: string
    firstName?: string
    lastName?: string
  } | null

  return {
    id: report.id,
    reporter:
      reporter && typeof reporter === 'object' && 'email' in reporter
        ? {
            id: reporter.id,
            firstName: reporter.firstName,
            lastName: reporter.lastName,
            email: reporter.email,
          }
        : { id: String(report.reporterId) },
    profile:
      profile && typeof profile === 'object' && 'headline' in profile
        ? { id: profile.id, headline: profile.headline }
        : { id: String(report.hrProfileId) },
    hrUser:
      hrUser && typeof hrUser === 'object' && 'email' in hrUser
        ? {
            id: hrUser.id,
            firstName: hrUser.firstName,
            lastName: hrUser.lastName,
            email: hrUser.email,
          }
        : { id: String(report.hrUserId) },
    reason: report.reason,
    details: report.details ?? undefined,
    status: report.status,
    resolvedBy:
      resolver && typeof resolver === 'object' && 'firstName' in resolver
        ? { id: resolver.id, firstName: resolver.firstName, lastName: resolver.lastName }
        : undefined,
    resolvedAt: report.resolvedAt ?? undefined,
    resolutionNotes: report.resolutionNotes ?? undefined,
    createdAt: report.createdAt,
  }
}
