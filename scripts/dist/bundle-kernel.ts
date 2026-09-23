/**
 * The second half of the kernel build, as upstream's `build:lib:host` runs it:
 * after `tsc -b` has emitted every kernel package's `lib/types/`, tsdown bundles
 * the published entries (`lib/index.js`, `lib/invariant.js`, the JSONL
 * backend's `lib/worker.cjs`) with the package's own `tsdown.config.ts`, or with
 * upstream's root options (`dsh/tsdown.config.ts`) for a package that has none.
 *
 *   node --import tsx scripts/dist/bundle-kernel.ts
 * @module scripts/dist/bundle-kernel
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { kernelPackages, repoRoot } from './kernel.ts'

const tsdown = join(repoRoot, 'node_modules/.bin/tsdown')

for (const { name, dir } of kernelPackages()) {
  const packageDir = join(repoRoot, 'dsh', dir)
  const own = join(packageDir, 'tsdown.config.ts')
  const config = existsSync(own) ? own : join(repoRoot, 'dsh/tsdown.config.ts')
  try {
    execFileSync(tsdown, ['--config', config, '--logLevel', 'warn'], { cwd: packageDir, stdio: ['ignore', 'ignore', 'inherit'] })
  } catch (error) {
    throw new Error(`${name}: tsdown failed in dsh/${dir}`, { cause: error })
  }
}
