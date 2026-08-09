import type { Response } from 'express'
import { isProduction } from '../config/env.js'
import { AUTH_COOKIES } from '../config/constants.js'

const accessMaxAge = 15 * 60 * 1000
const refreshMaxAge = 7 * 24 * 60 * 60 * 1000

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

// Lax only works when the API and the SPA share a site (same eTLD+1). A free-tier deployment
// almost always puts them on different domains (e.g. a Vercel frontend calling a Render backend),
// which makes the browser treat every API call as cross-site — Lax cookies are silently withheld
// on those, so login would appear to succeed and then look logged-out on the very next request.
// None requires Secure, which is only safe once we're actually on HTTPS, i.e. in production.
const sameSite = isProduction ? 'none' : 'lax'

export function setAuthCookies(res: Response, tokens: AuthTokens): void {
  res.cookie(AUTH_COOKIES.ACCESS, tokens.accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    path: '/',
    maxAge: accessMaxAge,
  })
  res.cookie(AUTH_COOKIES.REFRESH, tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    path: '/',
    maxAge: refreshMaxAge,
  })
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(AUTH_COOKIES.ACCESS, {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    path: '/',
  })
  res.clearCookie(AUTH_COOKIES.REFRESH, {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    path: '/',
  })
}
