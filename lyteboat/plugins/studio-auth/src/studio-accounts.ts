/**
 * Studio's own accounts, `<studio dir>/accounts.json`: username → user id,
 * display name, and a scrypt hash of the password (N=16384, r=8, p=1, a random
 * 16-byte salt per account, 64-byte key). Operators manage them with
 * `lyteboat studio account …`, which calls this module; the running Studio
 * reads the file on every login, so a change needs no restart. A password is
 * never stored, logged, or returned.
 * @module @lyteboat/studio-auth/accounts
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { readStudioJson, writeStudioJson } from './studio-files.ts'

/** One account as its file holds it. */
export interface StudioAccount {
  userId: string
  displayName: string
  /** `scrypt$<N>$<r>$<p>$<salt base64>$<key base64>`. */
  passwordHash: string
  createdAt: number
  updatedAt: number
}

const studioAccountSchema = z.strictObject({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  passwordHash: z.string().regex(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/u),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const studioAccountsFileSchema = z.strictObject({
  version: z.literal(1),
  accounts: z.record(z.string().min(1), studioAccountSchema),
})

const SCRYPT = { N: 16_384, r: 8, p: 1, keyLength: 64, saltLength: 16 } as const

/** A username an operator can type: letters, digits, `.`, `_`, `-`, `@`. */
export const STUDIO_USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/u

const accountsFile = (dir: string): string => join(dir, 'accounts.json')

/** Hash a password for storage. */
export function hashStudioPassword(password: string): string {
  const salt = randomBytes(SCRYPT.saltLength)
  const key = scryptSync(password, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return `scrypt$${String(SCRYPT.N)}$${String(SCRYPT.r)}$${String(SCRYPT.p)}$${salt.toString('base64')}$${key.toString('base64')}`
}

/** Whether a password matches a stored hash, compared in constant time. */
export function verifyStudioPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, key] = stored.split('$')
  if (scheme !== 'scrypt' || n === undefined || r === undefined || p === undefined || salt === undefined || key === undefined) return false
  const expected = Buffer.from(key, 'base64')
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.byteLength, { N: Number(n), r: Number(r), p: Number(p) })
  return timingSafeEqual(actual, expected)
}

/**
 * The accounts under a Studio directory, by username; empty when none were made.
 * @throws when the file exists but is malformed.
 */
export function readStudioAccounts(dir: string): Record<string, StudioAccount> {
  const raw = readStudioJson(accountsFile(dir))
  if (raw === undefined) return {}
  const parsed = studioAccountsFileSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`studio-auth: ${accountsFile(dir)} is malformed: ${parsed.error.issues.map(issue => `${issue.path.join('.') || '(the file)'}: ${issue.message}`).join('; ')}`)
  return parsed.data.accounts
}

/**
 * Create an account or set its password (and display name).
 * @param dir - the Studio directory.
 * @param username - the name the login page takes.
 * @param update - the password, and the user id and display name for a new account (the username by default).
 * @returns the account as stored.
 * @throws when the username is not one {@link STUDIO_USERNAME_PATTERN} admits, or the password is empty.
 */
export function setStudioAccount(dir: string, username: string, update: { password: string; userId?: string; displayName?: string }): StudioAccount {
  if (!STUDIO_USERNAME_PATTERN.test(username)) throw new Error(`studio-auth: "${username}" is not a username (letters, digits, and . _ @ - , up to 64)`)
  if (update.password === '') throw new Error('studio-auth: the password is empty')
  const accounts = readStudioAccounts(dir)
  const now = Date.now()
  const earlier = accounts[username]
  const account: StudioAccount = {
    userId: earlier?.userId ?? update.userId ?? username,
    displayName: update.displayName ?? earlier?.displayName ?? username,
    passwordHash: hashStudioPassword(update.password),
    createdAt: earlier?.createdAt ?? now,
    updatedAt: now,
  }
  writeStudioJson(accountsFile(dir), { version: 1, accounts: { ...accounts, [username]: account } })
  return account
}

/**
 * Remove an account; its role grant stays until an admin revokes it.
 * @returns whether there was one.
 */
export function removeStudioAccount(dir: string, username: string): boolean {
  const accounts = readStudioAccounts(dir)
  if (accounts[username] === undefined) return false
  writeStudioJson(accountsFile(dir), { version: 1, accounts: Object.fromEntries(Object.entries(accounts).filter(([name]) => name !== username)) })
  return true
}

// The operator's account commands also set the role an account signs in with.
export { readStudioGrants, setStudioGrant } from './studio-grants.ts'
