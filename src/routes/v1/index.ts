import { Router } from 'express'
import { authRouter } from './auth.routes.js'
import { availabilityRouter } from './availability.routes.js'
import { bookingRouter } from './booking.routes.js'
import { hrProfileRouter } from './hrProfile.routes.js'
import { integrationRouter } from './integration.routes.js'
import { uploadRouter } from './upload.routes.js'

export const apiV1Router: Router = Router()

apiV1Router.use('/auth', authRouter)
apiV1Router.use('/profiles', hrProfileRouter)
apiV1Router.use('/availability', availabilityRouter)
apiV1Router.use('/bookings', bookingRouter)
apiV1Router.use('/integrations', integrationRouter)
apiV1Router.use('/uploads', uploadRouter)

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
