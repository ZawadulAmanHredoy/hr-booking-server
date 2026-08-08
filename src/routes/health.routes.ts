import { Router } from 'express'
import { liveness, readiness } from '../controllers/health.controller.js'

export const healthRouter: Router = Router()

healthRouter.get('/', liveness)
healthRouter.get('/ready', readiness)
