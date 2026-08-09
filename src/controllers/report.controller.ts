import type { NextFunction, Request, Response } from 'express'
import { createReport, toReportResponse } from '../services/report.service.js'
import { sendSuccess } from '../utils/response.js'
import { UnauthorizedError } from '../utils/http-errors.js'

export async function createReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new UnauthorizedError())
      return
    }
    const report = await createReport(req.user.id, req.body)
    sendSuccess(res, { report: toReportResponse(report) }, 201)
  } catch (err) {
    next(err)
  }
}
