import type { NextFunction, Request, Response } from 'express'
import { sendSuccess } from '../utils/response.js'
import { BadRequestError } from '../utils/http-errors.js'

export function uploadAvatarHandler(req: Request, res: Response, next: NextFunction): void {
  if (!req.file) {
    next(new BadRequestError('An image file is required.'))
    return
  }
  // profileImageUrl is validated as a full URL (z.url()) everywhere it's stored, so this must
  // be absolute — a relative /uploads/... path would fail that check on save.
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
  sendSuccess(res, { url }, 201)
}
