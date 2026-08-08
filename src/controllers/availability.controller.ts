import type { NextFunction, Request, Response } from 'express'
import {
  getOrCreateAvailability,
  getPublishedProfileAvailability,
  toAvailabilityResponse,
  toPublicScheduleResponse,
  updateAvailability,
} from '../services/availability.service.js'
import { getAvailableSlots } from '../services/slot.service.js'
import { sendSuccess } from '../utils/response.js'
import { UnauthorizedError } from '../utils/http-errors.js'
import { addDays } from '../utils/datetime.js'
import type { SlotsQuery } from '../validators/availability.validator.js'

const DEFAULT_SLOT_WINDOW_DAYS = 14

export async function getMyAvailabilityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new UnauthorizedError())
      return
    }
    const availability = await getOrCreateAvailability(req.user.id)
    sendSuccess(res, { availability: toAvailabilityResponse(availability) })
  } catch (err) {
    next(err)
  }
}

export async function updateMyAvailabilityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new UnauthorizedError())
      return
    }
    const availability = await updateAvailability(req.user.id, req.body)
    sendSuccess(res, { availability: toAvailabilityResponse(availability) })
  } catch (err) {
    next(err)
  }
}

export async function getProfileSlotsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { profileId } = req.params as { profileId: string }
    const { availability } = await getPublishedProfileAvailability(profileId)

    const query = req.query as unknown as SlotsQuery
    const now = new Date()
    const from = query.from && query.from > now ? query.from : now
    const to = query.to ?? addDays(from, DEFAULT_SLOT_WINDOW_DAYS)

    const result = await getAvailableSlots(availability, { from, to }, now)

    sendSuccess(res, {
      schedule: toPublicScheduleResponse(availability),
      from: result.from,
      to: result.to,
      slotDurationMinutes: result.slotDurationMinutes,
      timezone: result.timezone,
      slots: result.slots,
    })
  } catch (err) {
    next(err)
  }
}
