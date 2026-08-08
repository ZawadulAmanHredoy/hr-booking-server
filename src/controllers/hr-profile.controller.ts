import type { NextFunction, Request, Response } from 'express'
import {
  getProfileByUserId,
  getPublicProfile,
  listPublicProfiles,
  setAvailability,
  setProfileStatus,
  toOwnProfile,
  upsertProfile,
} from '../services/hr-profile.service.js'
import { sendPaginated, sendSuccess } from '../utils/response.js'
import { NotFoundError } from '../utils/http-errors.js'
import type { ListProfilesQuery } from '../validators/hrProfile.validator.js'

export async function upsertProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new NotFoundError('Account not found.'))
      return
    }
    const { profile, upgraded } = await upsertProfile(req.user.id, req.body)
    sendSuccess(res, { profile: toOwnProfile(profile), upgraded })
  } catch (err) {
    next(err)
  }
}

export async function getMyProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new NotFoundError('Account not found.'))
      return
    }
    const profile = await getProfileByUserId(req.user.id)
    sendSuccess(res, { profile: toOwnProfile(profile) })
  } catch (err) {
    next(err)
  }
}

export async function publishProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new NotFoundError('Account not found.'))
      return
    }
    const profile = await setProfileStatus(req.user.id, req.body.status)
    sendSuccess(res, { profile: toOwnProfile(profile) })
  } catch (err) {
    next(err)
  }
}

export async function availabilityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new NotFoundError('Account not found.'))
      return
    }
    const profile = await setAvailability(req.user.id, req.body.isAvailable)
    sendSuccess(res, { profile: toOwnProfile(profile) })
  } catch (err) {
    next(err)
  }
}

export async function listProfilesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await listPublicProfiles(req.query as unknown as ListProfilesQuery)
    sendPaginated(res, result.data, result.pagination)
  } catch (err) {
    next(err)
  }
}

export async function getProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await getPublicProfile(String(req.params.id))
    sendSuccess(res, { profile })
  } catch (err) {
    next(err)
  }
}
