import type { NextFunction, Request, Response } from 'express'
import {
  cancelBooking,
  createBooking,
  getBookingForActor,
  listBookings,
  rescheduleBooking,
  toBookingResponse,
  type Actor,
} from '../services/booking.service.js'
import { sendPaginated, sendSuccess } from '../utils/response.js'
import { UnauthorizedError } from '../utils/http-errors.js'
import type { ListBookingsQuery } from '../validators/booking.validator.js'

export async function createBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req)
    const booking = await createBooking(actor, req.body)
    sendSuccess(
      res,
      { booking: toBookingResponse(await getBookingForActor(actor, booking.id)) },
      201,
    )
  } catch (err) {
    next(err)
  }
}

export async function listBookingsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req)
    const { data, pagination } = await listBookings(
      actor,
      req.query as unknown as ListBookingsQuery,
    )
    sendPaginated(res, data.map(toBookingResponse), pagination)
  } catch (err) {
    next(err)
  }
}

export async function getBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req)
    const booking = await getBookingForActor(actor, String(req.params.id))
    sendSuccess(res, { booking: toBookingResponse(booking) })
  } catch (err) {
    next(err)
  }
}

export async function cancelBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req)
    const booking = await cancelBooking(actor, String(req.params.id), req.body.reason)
    sendSuccess(res, { booking: toBookingResponse(booking) })
  } catch (err) {
    next(err)
  }
}

export async function rescheduleBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req)
    const booking = await rescheduleBooking(actor, String(req.params.id), req.body)
    sendSuccess(res, { booking: toBookingResponse(booking) })
  } catch (err) {
    next(err)
  }
}

function requireActor(req: Request): Actor {
  if (!req.user) {
    throw new UnauthorizedError()
  }
  return { id: req.user.id, role: req.user.role }
}
