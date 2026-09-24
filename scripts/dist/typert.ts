/**
 * The Typert files of kernel packages. A dsh package that exports a Typert Host
 * face (`./typert`) or Remote client (`./remote`) publishes `lib/typert.*`, which
 * upstream's generator emits from an analysis of its whole workspace; lyteboat's
 * workspace cannot host that analysis. So the import carries the published files
 * (import-upstream.ts), the build accepts them only while they match the source
 * (bundle-kernel.ts), and `dist:overlay … typert` regenerates them from lyteboat's
 * source inside an upstream checkout, recording the source digest they were
 * generated from in `dsh/typert.json`.
 * @module scripts/dist/typert
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { repoRoot, stableJson } from './kernel.ts'

interface TypertManifest {
  exports?: Record<string, unknown>
  files?: string[]
}

const STAMPS = join(repoRoot, 'dsh/typert.json')

/** The published Typert files of a package manifest; empty for a package with neither export. */
export function publishedTypertFiles(manifest: TypertManifest): string[] {
  const exports = manifest.exports ?? {}
  if (!Object.hasOwn(exports, './typert') && !Object.hasOwn(exports, './remote')) return []
  return (manifest.files ?? []).filter(file => /^lib\/typert\.[^/*]+$/u.test(file))
}

/** The published Typert files of the kernel package in `dsh/<dir>`. */
export function kernelTypertFiles(dir: string): string[] {
  return publishedTypertFiles(JSON.parse(readFileSync(join(repoRoot, 'dsh', dir, 'package.json'), 'utf8')) as TypertManifest)
}

/** SHA-256 over the relative paths and contents of every file under `dsh/<dir>/src`. */
export function typertSourceDigest(dir: string): string {
  const src = join(repoRoot, 'dsh', dir, 'src')
  const files = readdirSync(src, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(src, join(entry.parentPath, entry.name)))
    .sort()
  const hash = createHash('sha256')
  for (const file of files) hash.update(`${file}\0`).update(readFileSync(join(src, file))).update('\0')
  return hash.digest('hex')
}

/** Package name → the source digest its Typert files were last regenerated from. */
export function readTypertStamps(): Record<string, string> {
  if (!existsSync(STAMPS)) return {}
  return (JSON.parse(readFileSync(STAMPS, 'utf8')) as { packages: Record<string, string> }).packages
}

/** Record that `name`'s Typert files were regenerated from source with `digest`. */
export function writeTypertStamp(name: string, digest: string): void {
  const packages = { ...readTypertStamps(), [name]: digest }
  writeFileSync(STAMPS, stableJson({
    $comment: 'Written by `pnpm run dist:overlay <checkout> typert --write`: the digest of each kernel package\'s src/ that its lib/typert.* files were regenerated from (scripts/dist/typert.ts).',
    packages,
  }))
}
