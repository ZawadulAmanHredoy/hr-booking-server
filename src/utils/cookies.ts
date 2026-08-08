import type { Response } from 'express'
import { isProduction } from '../config/env.js'
import { AUTH_COOKIES } from '../config/constants.js'

const accessMaxAge = 15 * 60 * 1000
const refreshMaxAge = 7 * 24 * 60 * 60 * 1000

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export function setAuthCookies(res: Response, tokens: AuthTokens): void {
  res.cookie(AUTH_COOKIES.ACCESS, tokens.accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: accessMaxAge,
  })
  res.cookie(AUTH_COOKIES.REFRESH, tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: refreshMaxAge,
  })
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(AUTH_COOKIES.ACCESS, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  })
  res.clearCookie(AUTH_COOKIES.REFRESH, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  })
}
