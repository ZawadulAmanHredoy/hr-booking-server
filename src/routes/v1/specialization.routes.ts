import { Router } from 'express'
import { listPublicSpecializationsHandler } from '../../controllers/specialization.controller.js'

export const specializationRouter: Router = Router()

// Public — active specializations only, used to populate the HR profile form and directory filters.
specializationRouter.get('/', listPublicSpecializationsHandler)
