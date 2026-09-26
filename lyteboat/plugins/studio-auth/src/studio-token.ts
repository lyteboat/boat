/**
 * Studio's bearer tokens: `<payload>.<signature>`, both base64url; the payload
 * is `{sub, iat, exp}` (user id, issue and expiry times in epoch ms), the
 * signature an HMAC-SHA256 of the payload text under the secret in
 * `<studio dir>/token-secret` (32 random bytes, made on first use, 0600). A
 * token names a user; the role is read from the grants on every request, so a
 * revoked grant takes effect at once.
 * @module @lyteboat/studio-auth/studio-token
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { writeStudioJson } from './studio-files.ts'

const tokenPayloadSchema = z.strictObject({ sub: z.string().min(1), iat: z.number(), exp: z.number() })

/** The secret tokens are signed with, made on first use. */
export function studioTokenSecret(dir: string): Buffer {
  const file = join(dir, 'token-secret')
  if (!existsSync(file)) writeStudioJson(file, randomBytes(32).toString('hex'))
  const stored = JSON.parse(readFileSync(file, 'utf8')) as unknown
  if (typeof stored !== 'string' || !/^[0-9a-f]{64}$/u.test(stored)) throw new Error(`studio-auth: ${file} is not a token secret; remove it to make a new one (every signed-in user signs in again)`)
  return Buffer.from(stored, 'hex')
}

const sign = (secret: Buffer, payload: string): string => createHmac('sha256', secret).update(payload).digest('base64url')

/** Sign a token for a user. */
export function issueStudioToken(secret: Buffer, userId: string, now: number, ttlMs: number): { token: string; expiresAt: number } {
  const expiresAt = now + ttlMs
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: now, exp: expiresAt })).toString('base64url')
  return { token: `${payload}.${sign(secret, payload)}`, expiresAt }
}

/** The user a token names; undefined when it is malformed, forged, or expired. */
export function verifyStudioToken(secret: Buffer, token: string, now: number): string | undefined {
  const [payload, signature, extra] = token.split('.')
  if (payload === undefined || signature === undefined || extra !== undefined) return undefined
  const expected = Buffer.from(sign(secret, payload))
  const given = Buffer.from(signature)
  if (given.byteLength !== expected.byteLength || !timingSafeEqual(given, expected)) return undefined
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    // A payload that is not JSON cannot carry a valid signature from us; it is simply not a token.
    return undefined
  }
  const parsed = tokenPayloadSchema.safeParse(decoded)
  return parsed.success && parsed.data.exp > now ? parsed.data.sub : undefined
}
