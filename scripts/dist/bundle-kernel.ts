/**
 * The second half of the kernel build, as upstream's `build:lib:host` runs it:
 * after `tsc -b` has emitted every kernel package's `lib/types/`, tsdown bundles
 * the published entries (`lib/index.js`, `lib/invariant.js`, the JSONL
 * backend's `lib/worker.cjs`) with the package's own `tsdown.config.ts`, or with
 * upstream's root options (`dsh/tsdown.config.ts`) for a package that has none.
 *
 * A package's Typert files (`lib/typert.*`) are not built here: they come with
 * the import (scripts/dist/import-upstream.ts), because upstream's generator
 * needs its whole workspace. They are valid only while the package's source is
 * the imported source, so the build stops when lyteboat has changed it; then
 * `pnpm run dist:overlay <checkout> typert --write` regenerates them from lyteboat's
 * source in an upstream checkout.
 *
 *   node --import tsx scripts/dist/bundle-kernel.ts
 * @module scripts/dist/bundle-kernel
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lastImport } from './import-upstream.ts'
import { git, kernelPackages, repoRoot } from './kernel.ts'
import { kernelTypertFiles, readTypertStamps, typertSourceDigest } from './typert.ts'

// tsdown's bin script run by this Node: node_modules/.bin/tsdown is a POSIX shell shim, which Windows cannot spawn without a shell.
const tsdown = fileURLToPath(import.meta.resolve('tsdown/run'))

for (const { name, dir } of kernelPackages()) {
  const packageDir = join(repoRoot, 'dsh', dir)
  const own = join(packageDir, 'tsdown.config.ts')
  const config = existsSync(own) ? own : join(repoRoot, 'dsh/tsdown.config.ts')
  try {
    execFileSync(process.execPath, [tsdown, '--config', config, '--logLevel', 'warn'], { cwd: packageDir, stdio: ['ignore', 'ignore', 'inherit'] })
  } catch (error) {
    throw new Error(`${name}: tsdown failed in dsh/${dir}`, { cause: error })
  }
  checkTypert(name, dir)
}

/**
 * The Typert files are valid when the source is the imported source and the files
 * are the imported ones, or when `dist:overlay … typert --write` regenerated them
 * from exactly the current source (its digest in dsh/typert.json).
 */
function checkTypert(name: string, dir: string): void {
  const files = kernelTypertFiles(dir)
  if (files.length === 0) return
  const packageDir = join(repoRoot, 'dsh', dir)
  const missing = files.filter(file => !existsSync(join(packageDir, file)))
  if (missing.length > 0) throw new Error(`${name}: ${missing.join(', ')} missing; they come with the import (scripts/dist/import-upstream.ts)`)
  // Mid-sync, before the merge is committed, the new import is reachable only from MERGE_HEAD.
  const merging = existsSync(join(git(repoRoot, ['rev-parse', '--absolute-git-dir']), 'MERGE_HEAD'))
  const bases = [lastImport('HEAD'), merging ? lastImport('MERGE_HEAD') : undefined].filter(base => base !== undefined)
  if (bases.length === 0) return
  const paths = [`dsh/${dir}/src`, ...files.map(file => `dsh/${dir}/${file}`)]
  const imported = bases.some(base => git(repoRoot, ['diff', '--name-only', base, '--', ...paths]) === '')
  if (imported || readTypertStamps()[name] === typertSourceDigest(dir)) return
  throw new Error(`${name}: its source or Typert files (${files.join(', ')}) differ from the import, and dsh/typert.json records no regeneration from this source; `
    + 'run `pnpm run dist:overlay <upstream checkout at the tracked tag> typert --write` and commit the result with the source change')
}
