import { Router } from 'express'
import {
  googleCallbackHandler,
  googleConnectHandler,
  googleDisconnectHandler,
  listIntegrationsHandler,
} from '../../controllers/integration.controller.js'
import { authenticate, loadUser, requireRole } from '../../middlewares/auth.js'
import { USER_ROLES } from '../../config/constants.js'

export const integrationRouter: Router = Router()

// Public: Google redirects the browser here. Identity comes from the signed `state`.
integrationRouter.get('/google/callback', googleCallbackHandler)

integrationRouter.use(authenticate, loadUser, requireRole(USER_ROLES.HR))

integrationRouter.get('/', listIntegrationsHandler)
integrationRouter.get('/google/connect', googleConnectHandler)
integrationRouter.delete('/google', googleDisconnectHandler)
