import { GOOGLE_OAUTH } from '../../config/constants.js'
import { env, isGoogleConfigured } from '../../config/env.js'

export class GoogleApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'GoogleApiError'
    this.status = status
  }
}

export interface GoogleTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: Date
  scopes: string[]
}

export interface GoogleIdentity {
  sub: string
  email?: string
}

export function assertGoogleConfigured(): void {
  if (!isGoogleConfigured) {
    throw new GoogleApiError('Google integration is not configured on this server.', 503)
  }
}

export function buildAuthUrl(state: string): string {
  assertGoogleConfigured()

  const url = new URL(GOOGLE_OAUTH.AUTH_URL)
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID as string)
  url.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_OAUTH.SCOPES.join(' '))
  // offline + consent is what guarantees a refresh token even on a repeat authorisation.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)

  return url.toString()
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  return requestTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
  })
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return requestTokens({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

export async function fetchIdentity(accessToken: string): Promise<GoogleIdentity> {
  const res = await fetch(GOOGLE_OAUTH.USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    throw new GoogleApiError('Could not read the Google account profile.', res.status)
  }

  const body = (await res.json()) as { sub?: string; email?: string }
  if (!body.sub) {
    throw new GoogleApiError('Google did not return an account identifier.', 502)
  }

  return { sub: body.sub, email: body.email }
}

/** Best-effort: a failed revoke must not stop us from forgetting the connection locally. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(GOOGLE_OAUTH.REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
    return res.ok
  } catch {
    return false
  }
}

async function requestTokens(params: Record<string, string>): Promise<GoogleTokens> {
  assertGoogleConfigured()

  const res = await fetch(GOOGLE_OAUTH.TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: env.GOOGLE_CLIENT_ID as string,
      client_secret: env.GOOGLE_CLIENT_SECRET as string,
    }).toString(),
  })

  const body = (await res.json().catch(() => null)) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  } | null

  if (!res.ok || !body?.access_token) {
    // Google's error bodies never contain our secrets, but keep the surface small anyway.
    throw new GoogleApiError(
      body?.error_description ?? body?.error ?? 'Google rejected the token request.',
      res.status,
    )
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    scopes: body.scope ? body.scope.split(' ') : [...GOOGLE_OAUTH.SCOPES],
  }
}
