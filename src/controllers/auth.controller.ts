import type { NextFunction, Request, Response } from 'express'
import {
  forgotPassword,
  getUserById,
  login,
  logout,
  refresh,
  register,
  registerHr,
  resetPassword,
  toPublicUser,
  verifyEmail,
} from '../services/auth.service.js'
import { AUTH_COOKIES } from '../config/constants.js'
import { clearAuthCookies, setAuthCookies } from '../utils/cookies.js'
import { sendSuccess } from '../utils/response.js'
import { NotFoundError } from '../utils/http-errors.js'

function getDeviceContext(req: Request): { ip?: string; userAgent?: string } {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  }
}

export async function registerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await register(req.body)
    sendSuccess(
      res,
      { user: toPublicUser(user), message: 'Registration successful. Please verify your email.' },
      201,
    )
  } catch (err) {
    next(err)
  }
}

export async function registerHrHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await registerHr(req.body)
    sendSuccess(
      res,
      {
        user: toPublicUser(user),
        message: 'Registration successful. You can log in right away.',
      },
      201,
    )
  } catch (err) {
    next(err)
  }
}

export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await login(req.body, getDeviceContext(req))
    setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    })
    sendSuccess(res, { user: toPublicUser(result.user) })
  } catch (err) {
    next(err)
  }
}

export async function refreshHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const refreshToken = req.cookies?.[AUTH_COOKIES.REFRESH] as string | undefined
    const result = await refresh(refreshToken, getDeviceContext(req))
    setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    })
    sendSuccess(res, { user: toPublicUser(result.user) })
  } catch (err) {
    next(err)
  }
}

export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const refreshToken = req.cookies?.[AUTH_COOKIES.REFRESH] as string | undefined
    await logout(refreshToken)
    clearAuthCookies(res)
    sendSuccess(res, { message: 'Logged out successfully.' })
  } catch (err) {
    next(err)
  }
}

export async function verifyEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await verifyEmail(req.body.token)
    sendSuccess(res, {
      user: toPublicUser(user),
      message: 'Email verified successfully. You can now log in.',
    })
  } catch (err) {
    next(err)
  }
}

export async function forgotPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await forgotPassword(req.body.email)
    sendSuccess(res, {
      message: 'If an account exists for that email, a reset link has been sent.',
    })
  } catch (err) {
    next(err)
  }
}

export async function resetPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await resetPassword(req.body.token, req.body.password)
    sendSuccess(res, { message: 'Password reset successfully. You can now log in.' })
  } catch (err) {
    next(err)
  }
}

export async function meHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new NotFoundError('Account not found.'))
      return
    }
    const doc = await getUserById(req.user.id)
    sendSuccess(res, { user: toPublicUser(doc) })
  } catch (err) {
    next(err)
  }
}
