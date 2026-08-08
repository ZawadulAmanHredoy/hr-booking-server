import {
  GOOGLE_OAUTH,
  OAUTH_PROVIDERS,
  TOKEN_TYPES,
  type OAuthProvider,
} from '../config/constants.js'
import { isGoogleConfigured } from '../config/env.js'
import { logger } from '../config/logger.js'
import { OAuthAccount, type OAuthAccountDocument } from '../models/OAuthAccount.js'
import {
  GoogleApiError,
  buildAuthUrl,
  exchangeCode,
  fetchIdentity,
  refreshAccessToken,
  revokeToken,
} from '../integrations/google/google-oauth.client.js'
import { decryptSecret, encryptSecret } from '../utils/crypto.js'
import { BadRequestError, NotFoundError } from '../utils/http-errors.js'
import { signGenericToken, verifyGenericToken } from '../utils/tokens.js'

export class OAuthConnectionError extends Error {
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'OAuthConnectionError'
    this.reason = reason
  }
}

/** The consent URL. `state` is a short-lived signed JWT, which is also the CSRF defence. */
export function buildGoogleConnectUrl(userId: string): string {
  return buildAuthUrl(signGenericToken(userId, TOKEN_TYPES.OAUTH_STATE))
}

export async function completeGoogleConnection(
  code: string,
  state: string,
): Promise<OAuthAccountDocument> {
  let userId: string
  try {
    userId = verifyGenericToken(state, TOKEN_TYPES.OAUTH_STATE).sub
  } catch {
    throw new OAuthConnectionError('invalid_state', 'The authorisation request expired.')
  }

  const tokens = await exchangeCode(code)
  const identity = await fetchIdentity(tokens.accessToken)

  const existing = await OAuthAccount.findOne({
    userId,
    provider: OAUTH_PROVIDERS.GOOGLE,
  }).select('+refreshToken')

  const refreshToken = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken)
    : existing?.refreshToken

  if (!refreshToken) {
    throw new OAuthConnectionError(
      'missing_refresh_token',
      'Google did not return a refresh token. Remove the app from your Google account permissions and try again.',
    )
  }

  const account = await OAuthAccount.findOneAndUpdate(
    { userId, provider: OAUTH_PROVIDERS.GOOGLE },
    {
      $set: {
        providerAccountId: identity.sub,
        accountEmail: identity.email,
        refreshToken,
        accessToken: encryptSecret(tokens.accessToken),
        accessTokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      },
      $unset: { lastError: '' },
      $setOnInsert: { calendarId: 'primary' },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  )

  logger.info({ userId, provider: OAUTH_PROVIDERS.GOOGLE }, 'OAuth account connected')

  return account as OAuthAccountDocument
}

export async function getConnection(
  userId: string,
  provider: OAuthProvider = OAUTH_PROVIDERS.GOOGLE,
): Promise<OAuthAccountDocument | null> {
  return OAuthAccount.findOne({ userId, provider })
}

export async function disconnectGoogle(userId: string): Promise<void> {
  const account = await OAuthAccount.findOne({
    userId,
    provider: OAUTH_PROVIDERS.GOOGLE,
  }).select('+refreshToken')

  if (!account) {
    throw new NotFoundError('No Google account is connected.')
  }

  // Revoking is best-effort; the local record goes either way.
  await revokeToken(safeDecrypt(account.refreshToken) ?? '')
  await account.deleteOne()

  logger.info({ userId, provider: OAUTH_PROVIDERS.GOOGLE }, 'OAuth account disconnected')
}

export interface GoogleAccess {
  accessToken: string
  calendarId: string
}

/**
 * Usable Google credentials for the consultant, refreshing when the access token is close to
 * expiry. A dead refresh token is recorded on the account so the UI can ask for a reconnection.
 */
export async function getGoogleAccess(userId: string): Promise<GoogleAccess> {
  const account = await OAuthAccount.findOne({
    userId,
    provider: OAUTH_PROVIDERS.GOOGLE,
  }).select('+refreshToken +accessToken')

  if (!account) {
    throw new OAuthConnectionError(
      'not_connected',
      'The consultant has not connected a Google account.',
    )
  }

  const stillValid =
    account.accessToken &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt.getTime() - GOOGLE_OAUTH.TOKEN_EXPIRY_SKEW_MS > Date.now()

  if (stillValid) {
    const token = safeDecrypt(account.accessToken as string)
    if (token) {
      return { accessToken: token, calendarId: account.calendarId }
    }
  }

  const refreshToken = safeDecrypt(account.refreshToken)
  if (!refreshToken) {
    await recordAccountError(account, 'Stored Google credentials could not be read.')
    throw new OAuthConnectionError(
      'unreadable_credentials',
      'Stored Google credentials could not be read. Reconnect the account.',
    )
  }

  try {
    const tokens = await refreshAccessToken(refreshToken)
    account.accessToken = encryptSecret(tokens.accessToken)
    account.accessTokenExpiresAt = tokens.expiresAt
    account.set('lastError', undefined)
    await account.save()
    return { accessToken: tokens.accessToken, calendarId: account.calendarId }
  } catch (err) {
    const message =
      err instanceof GoogleApiError ? err.message : 'Google refused to refresh the access token.'
    await recordAccountError(account, message)
    throw new OAuthConnectionError('refresh_failed', message)
  }
}

export function toConnectionResponse(
  account: OAuthAccountDocument | null,
): Record<string, unknown> {
  return {
    configured: isGoogleConfigured,
    connected: Boolean(account),
    accountEmail: account?.accountEmail ?? undefined,
    scopes: account?.scopes ?? [],
    connectedAt: account?.createdAt ?? undefined,
    needsReconnect: Boolean(account?.lastError),
    lastError: account?.lastError ?? undefined,
  }
}

export function assertCallbackParams(query: Record<string, unknown>): {
  code: string
  state: string
} {
  if (typeof query.error === 'string') {
    throw new OAuthConnectionError(query.error, 'Google authorisation was declined.')
  }
  if (typeof query.code !== 'string' || typeof query.state !== 'string') {
    throw new BadRequestError('The Google callback is missing its code or state.')
  }
  return { code: query.code, state: query.state }
}

async function recordAccountError(account: OAuthAccountDocument, message: string): Promise<void> {
  account.lastError = message.slice(0, 300)
  await account.save().catch(() => undefined)
}

function safeDecrypt(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  try {
    return decryptSecret(value)
  } catch {
    return null
  }
}
