import { Router } from 'express'
import {
  cancelBookingHandler,
  createBookingHandler,
  getBookingHandler,
  listBookingsHandler,
  rescheduleBookingHandler,
} from '../../controllers/booking.controller.js'
import { authenticate, loadUser } from '../../middlewares/auth.js'
import { validateBody, validateParams, validateQuery } from '../../middlewares/validate.js'
import {
  bookingIdParamsSchema,
  cancelBookingSchema,
  createBookingSchema,
  listBookingsQuerySchema,
  rescheduleBookingSchema,
} from '../../validators/booking.validator.js'

export const bookingRouter: Router = Router()

bookingRouter.use(authenticate, loadUser)

bookingRouter.post('/', validateBody(createBookingSchema), createBookingHandler)
bookingRouter.get('/', validateQuery(listBookingsQuerySchema), listBookingsHandler)
bookingRouter.get('/:id', validateParams(bookingIdParamsSchema), getBookingHandler)
bookingRouter.patch(
  '/:id/cancel',
  validateParams(bookingIdParamsSchema),
  validateBody(cancelBookingSchema),
  cancelBookingHandler,
)
bookingRouter.patch(
  '/:id/reschedule',
  validateParams(bookingIdParamsSchema),
  validateBody(rescheduleBookingSchema),
  rescheduleBookingHandler,
)
