import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import {
  OAuthConnectionError,
  assertCallbackParams,
  buildGoogleConnectUrl,
  completeGoogleConnection,
  disconnectGoogle,
  getConnection,
  toConnectionResponse,
} from '../services/oauth.service.js'
import { GoogleApiError } from '../integrations/google/google-oauth.client.js'
import { sendSuccess } from '../utils/response.js'
import {
  BadRequestError,
  IntegrationUnavailableError,
  UnauthorizedError,
} from '../utils/http-errors.js'

const INTEGRATIONS_PATH = '/profile/integrations'

export async function listIntegrationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new UnauthorizedError())
      return
    }
    const account = await getConnection(req.user.id)
    sendSuccess(res, { google: toConnectionResponse(account) })
  } catch (err) {
    next(err)
  }
}

export async function googleConnectHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new UnauthorizedError())
      return
    }
    sendSuccess(res, { url: buildGoogleConnectUrl(req.user.id) })
  } catch (err) {
    next(err instanceof GoogleApiError ? new IntegrationUnavailableError(err.message) : err)
  }
}

/**
 * Google redirects the consultant's browser here, so the response is a redirect back into the
 * SPA rather than JSON. Identity comes from the signed `state`, never from a cookie.
 */
export async function googleCallbackHandler(req: Request, res: Response): Promise<void> {
  try {
    const { code, state } = assertCallbackParams(req.query as Record<string, unknown>)
    const account = await completeGoogleConnection(code, state)
    res.redirect(redirectUrl({ status: 'connected', account: account.accountEmail ?? undefined }))
  } catch (err) {
    const reason =
      err instanceof OAuthConnectionError
        ? err.reason
        : err instanceof BadRequestError
          ? 'missing_parameters'
          : err instanceof GoogleApiError
            ? 'google_error'
            : 'unexpected_error'

    logger.warn({ reason }, 'Google OAuth callback failed')
    res.redirect(redirectUrl({ status: 'error', reason }))
  }
}

export async function googleDisconnectHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new UnauthorizedError())
      return
    }
    await disconnectGoogle(req.user.id)
    const account = await getConnection(req.user.id)
    sendSuccess(res, { google: toConnectionResponse(account) })
  } catch (err) {
    next(err)
  }
}

function redirectUrl(params: Record<string, string | undefined>): string {
  const url = new URL(INTEGRATIONS_PATH, env.CLIENT_URL)
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}
