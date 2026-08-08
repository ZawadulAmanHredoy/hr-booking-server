import { hash, verify } from '@node-rs/argon2'
import { AUTH_LIMITS } from '../config/constants.js'

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return verify(hashed, password)
}

export function isPasswordStrongEnough(password: string): boolean {
  if (password.length < AUTH_LIMITS.PASSWORD_MIN_LENGTH) return false
  if (password.length > AUTH_LIMITS.PASSWORD_MAX_LENGTH) return false
  if (!/[a-zA-Z]/.test(password)) return false
  if (!/\d/.test(password)) return false
  return true
}
