import { AuditLog, type AuditLogDocument } from '../models/AuditLog.js'
import type { AuditAction, AuditResourceType } from '../config/constants.js'
import { logger } from '../config/logger.js'
import type { Pagination } from '../utils/response.js'

export interface RecordAuditLogInput {
  actorId: string
  actorRole: string
  action: AuditAction
  resourceType?: AuditResourceType
  resourceId?: string
  metadata?: Record<string, unknown>
}

/**
 * Never throws — an audit-trail write failing should not undo (or fail) the admin action it is
 * recording, the same posture as booking email/reminder dispatch elsewhere in this codebase.
 */
export async function recordAuditLog(input: RecordAuditLogInput): Promise<void> {
  try {
    await AuditLog.create(input)
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, action: input.action },
      'Failed to record audit log',
    )
  }
}

export interface ListAuditLogsQuery {
  page: number
  limit: number
  action?: string
  actorId?: string
  resourceType?: string
}

export async function listAuditLogs(
  query: ListAuditLogsQuery,
): Promise<{ data: AuditLogDocument[]; pagination: Pagination }> {
  const filter: Record<string, unknown> = {}
  if (query.action) filter.action = query.action
  if (query.actorId) filter.actorId = query.actorId
  if (query.resourceType) filter.resourceType = query.resourceType

  const total = await AuditLog.countDocuments(filter)
  const totalPages = Math.max(1, Math.ceil(total / query.limit))
  const page = Math.min(query.page, totalPages)

  const data = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * query.limit)
    .limit(query.limit)
    .populate('actorId', 'firstName lastName email')

  return { data, pagination: { page, limit: query.limit, total, totalPages } }
}

export function toAuditLogResponse(log: AuditLogDocument): Record<string, unknown> {
  const actor = log.actorId as unknown as {
    id?: string
    firstName?: string
    lastName?: string
    email?: string
  } | null

  return {
    id: log.id,
    actor:
      actor && typeof actor === 'object' && 'email' in actor
        ? { id: actor.id, firstName: actor.firstName, lastName: actor.lastName, email: actor.email }
        : { id: String(log.actorId) },
    actorRole: log.actorRole,
    action: log.action,
    resourceType: log.resourceType ?? undefined,
    resourceId: log.resourceId ?? undefined,
    metadata: log.metadata ?? undefined,
    createdAt: log.createdAt,
  }
}
