/**
 * Studio's role grants, `<studio dir>/grants.json`: user id → role and who set
 * it when. Two rules hold for every change made through Studio: nobody changes
 * or revokes their own grant, and the last admin stays an admin. An operator at
 * the command line (`lyteboat studio account add --role`) and the startup's
 * `--admin` ids set grants directly.
 * @module @lyteboat/studio-auth/studio-grants
 */

import { join } from 'node:path'
import { z } from 'zod'
import { studioRoleSchema, type StudioGrant, type StudioRole } from '@lyteboat/contracts/studio'
import { readStudioJson, writeStudioJson } from './studio-files.ts'

const studioGrantSchema: z.ZodType<StudioGrant> = z.strictObject({
  userId: z.string().min(1),
  role: studioRoleSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  createdBy: z.string(),
  updatedBy: z.string(),
})

const studioGrantsFileSchema = z.strictObject({
  version: z.literal(1),
  grants: z.record(z.string().min(1), studioGrantSchema),
})

const grantsFile = (dir: string): string => join(dir, 'grants.json')

/**
 * The grants under a Studio directory, by user id; empty when none were made.
 * @throws when the file exists but is malformed.
 */
export function readStudioGrants(dir: string): Record<string, StudioGrant> {
  const raw = readStudioJson(grantsFile(dir))
  if (raw === undefined) return {}
  const parsed = studioGrantsFileSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`studio-auth: ${grantsFile(dir)} is malformed: ${parsed.error.issues.map(issue => `${issue.path.join('.') || '(the file)'}: ${issue.message}`).join('; ')}`)
  return parsed.data.grants
}

/** Replace the grants under a Studio directory. */
export function writeStudioGrants(dir: string, grants: Record<string, StudioGrant>): void {
  writeStudioJson(grantsFile(dir), { version: 1, grants })
}

/**
 * Set one grant as an operator (no Studio rule applies).
 * @param by - who set it, as the Users page shows (`cli`, `startup`, `gateway`).
 * @returns the grant as stored.
 */
export function setStudioGrant(dir: string, userId: string, role: StudioRole, by: string): StudioGrant {
  const grants = readStudioGrants(dir)
  const now = Date.now()
  const earlier = grants[userId]
  const grant: StudioGrant = { userId, role, createdAt: earlier?.createdAt ?? now, updatedAt: now, createdBy: earlier?.createdBy ?? by, updatedBy: by }
  writeStudioGrants(dir, { ...grants, [userId]: grant })
  return grant
}

/** Why a change made through Studio breaks a rule; undefined when it keeps both. */
export function studioGrantConflict(grants: Record<string, StudioGrant>, actor: string, userId: string, role: StudioRole | undefined): string | undefined {
  if (actor === userId) return 'you cannot change or revoke your own role'
  const target = grants[userId]
  if (target?.role !== 'admin' || role === 'admin') return undefined
  const admins = Object.values(grants).filter(grant => grant.role === 'admin').length
  return admins <= 1 ? 'the last admin cannot lose the admin role' : undefined
}
