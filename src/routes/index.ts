import { Router } from 'express'
import { healthRouter } from './health.routes.js'
import { apiV1Router } from './v1/index.js'

export const routes: Router = Router()

routes.use('/health', healthRouter)
routes.use('/api/v1', apiV1Router)
