import type { NextFunction, Request, Response } from 'express'
import { getDashboardStats } from '../services/admin-dashboard.service.js'
import { getPlatformSettings } from '../services/admin-settings.service.js'
import {
  deleteUser,
  getUserDetail,
  listUsers,
  reactivateUser,
  suspendUser,
  toAdminUser,
} from '../services/admin-user.service.js'
import {
  approveProfile,
  getProfileForAdminById,
  listProfilesForAdmin,
  rejectProfile,
  toAdminProfile,
} from '../services/hr-profile.service.js'
import { listBookingsForAdmin, toBookingList } from '../services/booking.service.js'
import {
  createSpecialization,
  deleteSpecialization,
  listSpecializations,
  toSpecializationResponse,
  updateSpecialization,
} from '../services/specialization.service.js'
import { listReports, resolveReport, toReportResponse } from '../services/report.service.js'
import { listAuditLogs, toAuditLogResponse } from '../services/audit-log.service.js'
import { sendPaginated, sendSuccess } from '../utils/response.js'
import { UnauthorizedError } from '../utils/http-errors.js'
import type {
  ListAdminBookingsQuery,
  ListAdminProfilesQuery,
  ListAuditLogsQuery,
  ListUsersQuery,
} from '../validators/admin.validator.js'
import type { ListReportsQuery } from '../validators/report.validator.js'

function requireAdmin(req: Request): { id: string; role: string } {
  if (!req.user) {
    throw new UnauthorizedError()
  }
  return { id: req.user.id, role: req.user.role }
}

export async function dashboardHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const stats = await getDashboardStats()
    sendSuccess(res, { stats })
  } catch (err) {
    next(err)
  }
}

export async function settingsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const settings = await getPlatformSettings()
    sendSuccess(res, { settings })
  } catch (err) {
    next(err)
  }
}

export async function listUsersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { data, pagination } = await listUsers(req.query as unknown as ListUsersQuery)
    sendPaginated(res, data.map(toAdminUser), pagination)
  } catch (err) {
    next(err)
  }
}

export async function getUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { user, hrProfile } = await getUserDetail(String(req.params.id))
    sendSuccess(res, { user: toAdminUser(user), hrProfile })
  } catch (err) {
    next(err)
  }
}

export async function suspendUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireAdmin(req)
    const user = await suspendUser(actor, String(req.params.id), req.body.reason)
    sendSuccess(res, { user: toAdminUser(user) })
  } catch (err) {
    next(err)
  }
}

export async function reactivateUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireAdmin(req)
    const user = await reactivateUser(actor, String(req.params.id))
    sendSuccess(res, { user: toAdminUser(user) })
  } catch (err) {
    next(err)
  }
}

export async function deleteUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireAdmin(req)
    const summary = await deleteUser(actor, String(req.params.id))
    sendSuccess(res, { message: 'User deleted.', email: summary.email })
  } catch (err) {
    next(err)
  }
}

export async function listAdminProfilesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { data, pagination } = await listProfilesForAdmin(
      req.query as unknown as ListAdminProfilesQuery,
    )
    sendPaginated(res, data, pagination)
  } catch (err) {
    next(err)
  }
}

export async function getAdminProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await getProfileForAdminById(String(req.params.id))
    sendSuccess(res, { profile: toAdminProfile(profile) })
  } catch (err) {
    next(err)
  }
}

export async function approveProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireAdmin(req)
    const profile = await approveProfile(actor, String(req.params.id))
    sendSuccess(res, { profile: toAdminProfile(profile) })
  } catch (err) {
    next(err)
  }
}

export async function rejectProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireAdmin(req)
    const profile = await rejectProfile(actor, String(req.params.id), req.body.reason)
    sendSuccess(res, { profile: toAdminProfile(profile) })
  } catch (err) {
    next(err)
  }
}

export async function listAdminBookingsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { data, pagination } = await listBookingsForAdmin(
      req.query as unknown as ListAdminBookingsQuery,
    )
    sendPaginated(res, await toBookingList(data), pagination)
  } catch (err) {
    next(err)
  }
}

export async function listAdminSpecializationsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const specializations = await listSpecializations({ includeInactive: true })
    sendSuccess(res, { specializations: specializations.map(toSpecializationResponse) })
  } catch (err) {
    next(err)
  }
}

export async function createSpecializationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const specialization = await createSpecialization(req.body)
    sendSuccess(res, { specialization: toSpecializationResponse(specialization) }, 201)
  } catch (err) {
    next(err)
  }
}

export async function updateSpecializationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const specialization = await updateSpecialization(String(req.params.id), req.body)
    sendSuccess(res, { specialization: toSpecializationResponse(specialization) })
  } catch (err) {
    next(err)
  }
}

export async function deleteSpecializationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await deleteSpecialization(String(req.params.id))
    sendSuccess(res, { message: 'Specialization deleted.' })
  } catch (err) {
    next(err)
  }
}

export async function listAdminReportsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { data, pagination } = await listReports(req.query as unknown as ListReportsQuery)
    sendPaginated(res, data.map(toReportResponse), pagination)
  } catch (err) {
    next(err)
  }
}

export async function resolveReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireAdmin(req)
    const report = await resolveReport(actor, String(req.params.id), req.body)
    sendSuccess(res, { report: toReportResponse(report) })
  } catch (err) {
    next(err)
  }
}

export async function listAuditLogsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { data, pagination } = await listAuditLogs(req.query as unknown as ListAuditLogsQuery)
    sendPaginated(res, data.map(toAuditLogResponse), pagination)
  } catch (err) {
    next(err)
  }
}
