import { Router } from 'express'
import {
  getMyAvailabilityHandler,
  getProfileSlotsHandler,
  updateMyAvailabilityHandler,
} from '../../controllers/availability.controller.js'
import { authenticate, loadUser, requireRole } from '../../middlewares/auth.js'
import { validateBody, validateParams, validateQuery } from '../../middlewares/validate.js'
import {
  profileIdParamsSchema,
  slotsQuerySchema,
  updateAvailabilitySchema,
} from '../../validators/availability.validator.js'
import { USER_ROLES } from '../../config/constants.js'

export const availabilityRouter: Router = Router()

// HR-only — the consultant's own working hours
availabilityRouter.get(
  '/me',
  authenticate,
  loadUser,
  requireRole(USER_ROLES.HR),
  getMyAvailabilityHandler,
)
availabilityRouter.put(
  '/me',
  authenticate,
  loadUser,
  requireRole(USER_ROLES.HR),
  validateBody(updateAvailabilitySchema),
  updateMyAvailabilityHandler,
)

// Public — bookable slots for a published profile
availabilityRouter.get(
  '/:profileId/slots',
  validateParams(profileIdParamsSchema),
  validateQuery(slotsQuerySchema),
  getProfileSlotsHandler,
)
