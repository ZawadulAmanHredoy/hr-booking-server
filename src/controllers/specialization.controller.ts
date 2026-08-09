import type { NextFunction, Request, Response } from 'express'
import {
  listSpecializations,
  toSpecializationResponse,
} from '../services/specialization.service.js'
import { sendSuccess } from '../utils/response.js'

export async function listPublicSpecializationsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const specializations = await listSpecializations()
    sendSuccess(res, { specializations: specializations.map(toSpecializationResponse) })
  } catch (err) {
    next(err)
  }
}
