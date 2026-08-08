import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../src/utils/crypto.js'

describe('OAuth secret encryption', () => {
  it('round-trips a value', () => {
    const secret = '1//0gRefreshTokenFromGoogle-with_symbols.123'

    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it('never emits the plaintext', () => {
    const secret = 'super-secret-refresh-token'

    expect(encryptSecret(secret)).not.toContain(secret)
  })

  it('uses a fresh IV for every call', () => {
    const secret = 'same-input'

    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret))
  })

  it('rejects a tampered payload', () => {
    const encrypted = encryptSecret('do-not-modify')
    const raw = Buffer.from(encrypted, 'base64')
    raw[raw.length - 1] ^= 0xff

    expect(() => decryptSecret(raw.toString('base64'))).toThrow()
  })

  it('rejects a truncated payload', () => {
    expect(() => decryptSecret(Buffer.from('short').toString('base64'))).toThrow(/malformed/i)
  })

  it('handles unicode', () => {
    const secret = 'রিফ্রেশ-টোকেন-🔐'

    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })
})
