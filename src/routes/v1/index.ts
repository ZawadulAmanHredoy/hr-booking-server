import { Router } from 'express'
import { authRouter } from './auth.routes.js'

export const apiV1Router: Router = Router()

apiV1Router.use('/auth', authRouter)

apiV1Router.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      name: 'HR Booking API',
      version: 'v1',
      docs: '/api/docs',
    },
  })
})
