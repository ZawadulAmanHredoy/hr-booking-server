import { Router } from 'express'
import {
  availabilityHandler,
  getMyProfileHandler,
  getProfileHandler,
  listProfilesHandler,
  submitProfileHandler,
  upsertProfileHandler,
  withdrawProfileHandler,
} from '../../controllers/hr-profile.controller.js'
import { authenticate, loadUser, requireRole } from '../../middlewares/auth.js'
import { validateBody, validateParams, validateQuery } from '../../middlewares/validate.js'
import {
  availabilitySchema,
  listProfilesQuerySchema,
  profileIdParamsSchema,
  upsertProfileSchema,
} from '../../validators/hrProfile.validator.js'
import { USER_ROLES } from '../../config/constants.js'

export const hrProfileRouter: Router = Router()

// Authenticated — own profile. PUT /me doubles as onboarding for USER-role accounts.
hrProfileRouter.put(
  '/me',
  authenticate,
  loadUser,
  validateBody(upsertProfileSchema),
  upsertProfileHandler,
)

// HR-only (must be registered before the public /:id catch-all)
hrProfileRouter.get('/me', authenticate, loadUser, requireRole(USER_ROLES.HR), getMyProfileHandler)
hrProfileRouter.patch(
  '/me/submit',
  authenticate,
  loadUser,
  requireRole(USER_ROLES.HR),
  submitProfileHandler,
)
hrProfileRouter.patch(
  '/me/withdraw',
  authenticate,
  loadUser,
  requireRole(USER_ROLES.HR),
  withdrawProfileHandler,
)
hrProfileRouter.patch(
  '/me/availability',
  authenticate,
  loadUser,
  requireRole(USER_ROLES.HR),
  validateBody(availabilitySchema),
  availabilityHandler,
)

// Public
hrProfileRouter.get('/', validateQuery(listProfilesQuerySchema), listProfilesHandler)
hrProfileRouter.get('/:id', validateParams(profileIdParamsSchema), getProfileHandler)
