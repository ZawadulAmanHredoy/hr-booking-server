import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { isProduction, isTest } from '../config/env.js'
import { AUTH_COOKIES } from '../config/constants.js'
import { UnauthorizedError, ForbiddenError } from '../utils/http-errors.js'
import { verifyAccessToken } from '../utils/tokens.js'
import { User } from '../models/User.js'
import { rateLimit } from 'express-rate-limit'

export interface AuthUser {
  id: string
  role: string
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const cookieToken = req.cookies?.[AUTH_COOKIES.ACCESS] as string | undefined
  const headerToken = extractBearerToken(req)

  const token = cookieToken ?? headerToken
  if (!token) {
    next(new UnauthorizedError())
    return
  }

  try {
    const payload = verifyAccessToken(token)
    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    next(new UnauthorizedError('Access token is invalid or expired.'))
  }
}

export function requireRole(...roles: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new UnauthorizedError())
      return
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError())
      return
    }
    next()
  }
}

export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    next(new UnauthorizedError())
    return
  }
  const user = await User.findById(req.user.id)
  if (!user || user.status !== 'ACTIVE') {
    next(new UnauthorizedError('Account is no longer active.'))
    return
  }
  req.user = { id: user.id, role: user.role }
  next()
}

const noopLimiter: RequestHandler = (_req, _res, next) => next()

export function authRateLimiter(): RequestHandler {
  if (isTest) {
    return noopLimiter
  }
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: isProduction ? 10 : 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    },
  })
}

export function apiRateLimiter(): RequestHandler {
  if (isTest) {
    return noopLimiter
  }
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    },
  })
}

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return undefined
  }
  return header.slice(7).trim()
}
