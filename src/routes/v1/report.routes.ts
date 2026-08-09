import { Router } from 'express'
import { createReportHandler } from '../../controllers/report.controller.js'
import { authenticate, loadUser } from '../../middlewares/auth.js'
import { validateBody } from '../../middlewares/validate.js'
import { createReportSchema } from '../../validators/report.validator.js'

export const reportRouter: Router = Router()

reportRouter.post(
  '/',
  authenticate,
  loadUser,
  validateBody(createReportSchema),
  createReportHandler,
)
