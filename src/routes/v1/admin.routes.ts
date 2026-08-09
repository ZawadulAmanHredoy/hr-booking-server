import { Router } from 'express'
import {
  approveProfileHandler,
  createSpecializationHandler,
  dashboardHandler,
  deleteSpecializationHandler,
  deleteUserHandler,
  getAdminProfileHandler,
  getUserHandler,
  listAdminBookingsHandler,
  listAdminProfilesHandler,
  listAdminReportsHandler,
  listAdminSpecializationsHandler,
  listAuditLogsHandler,
  listUsersHandler,
  reactivateUserHandler,
  rejectProfileHandler,
  resolveReportHandler,
  settingsHandler,
  suspendUserHandler,
  updateSpecializationHandler,
} from '../../controllers/admin.controller.js'
import { authenticate, loadUser, requireRole } from '../../middlewares/auth.js'
import { validateBody, validateParams, validateQuery } from '../../middlewares/validate.js'
import { USER_ROLES } from '../../config/constants.js'
import {
  adminIdParamsSchema,
  listAdminBookingsQuerySchema,
  listAdminProfilesQuerySchema,
  listAuditLogsQuerySchema,
  listUsersQuerySchema,
  rejectProfileSchema,
  suspendUserSchema,
} from '../../validators/admin.validator.js'
import {
  createSpecializationSchema,
  specializationIdParamsSchema,
  updateSpecializationSchema,
} from '../../validators/specialization.validator.js'
import {
  listReportsQuerySchema,
  reportIdParamsSchema,
  resolveReportSchema,
} from '../../validators/report.validator.js'

export const adminRouter: Router = Router()

adminRouter.use(authenticate, loadUser, requireRole(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN))

adminRouter.get('/dashboard', dashboardHandler)
adminRouter.get('/settings', settingsHandler)

adminRouter.get('/users', validateQuery(listUsersQuerySchema), listUsersHandler)
adminRouter.get('/users/:id', validateParams(adminIdParamsSchema), getUserHandler)
adminRouter.patch(
  '/users/:id/suspend',
  validateParams(adminIdParamsSchema),
  validateBody(suspendUserSchema),
  suspendUserHandler,
)
adminRouter.patch(
  '/users/:id/reactivate',
  validateParams(adminIdParamsSchema),
  reactivateUserHandler,
)
adminRouter.delete('/users/:id', validateParams(adminIdParamsSchema), deleteUserHandler)

adminRouter.get(
  '/hr-profiles',
  validateQuery(listAdminProfilesQuerySchema),
  listAdminProfilesHandler,
)
adminRouter.get('/hr-profiles/:id', validateParams(adminIdParamsSchema), getAdminProfileHandler)
adminRouter.patch(
  '/hr-profiles/:id/approve',
  validateParams(adminIdParamsSchema),
  approveProfileHandler,
)
adminRouter.patch(
  '/hr-profiles/:id/reject',
  validateParams(adminIdParamsSchema),
  validateBody(rejectProfileSchema),
  rejectProfileHandler,
)

adminRouter.get('/bookings', validateQuery(listAdminBookingsQuerySchema), listAdminBookingsHandler)

adminRouter.get('/specializations', listAdminSpecializationsHandler)
adminRouter.post(
  '/specializations',
  validateBody(createSpecializationSchema),
  createSpecializationHandler,
)
adminRouter.patch(
  '/specializations/:id',
  validateParams(specializationIdParamsSchema),
  validateBody(updateSpecializationSchema),
  updateSpecializationHandler,
)
adminRouter.delete(
  '/specializations/:id',
  validateParams(specializationIdParamsSchema),
  deleteSpecializationHandler,
)

adminRouter.get('/reports', validateQuery(listReportsQuerySchema), listAdminReportsHandler)
adminRouter.patch(
  '/reports/:id/resolve',
  validateParams(reportIdParamsSchema),
  validateBody(resolveReportSchema),
  resolveReportHandler,
)

adminRouter.get('/audit-logs', validateQuery(listAuditLogsQuerySchema), listAuditLogsHandler)
