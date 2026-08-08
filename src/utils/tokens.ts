import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { TOKEN_TYPES, type TokenType } from '../config/constants.js'

export interface AccessTokenPayload {
  sub: string
  role: string
  type: typeof TOKEN_TYPES.ACCESS
}

export interface GenericTokenPayload {
  sub: string
  type: TokenType
}

function getSecret(type: TokenType): string {
  if (type === TOKEN_TYPES.ACCESS) return env.JWT_ACCESS_SECRET
  return env.JWT_REFRESH_SECRET
}

function getExpiresIn(type: TokenType): string {
  switch (type) {
    case TOKEN_TYPES.ACCESS:
      return env.JWT_ACCESS_EXPIRES_IN
    case TOKEN_TYPES.VERIFY_EMAIL:
      return env.JWT_VERIFY_EMAIL_EXPIRES_IN
    case TOKEN_TYPES.RESET_PASSWORD:
      return env.JWT_RESET_PASSWORD_EXPIRES_IN
    default:
      return env.JWT_REFRESH_EXPIRES_IN
  }
}

type SignOptions = jwt.SignOptions

export function signAccessToken(userId: string, role: string): string {
  const payload: AccessTokenPayload = {
    sub: userId,
    role,
    type: TOKEN_TYPES.ACCESS,
  }
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
  })
}

export function signGenericToken(userId: string, type: TokenType): string {
  const payload: GenericTokenPayload = { sub: userId, type }
  return jwt.sign(payload, getSecret(type), {
    expiresIn: getExpiresIn(type) as SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload
}

export function verifyGenericToken(token: string, type: TokenType): GenericTokenPayload {
  const payload = jwt.verify(token, getSecret(type)) as GenericTokenPayload
  if (payload.type !== type) {
    throw new jwt.JsonWebTokenError('Token type mismatch')
  }
  return payload
}
