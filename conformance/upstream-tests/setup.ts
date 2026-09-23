/**
 * G2 setup file: upstream's tests run with upstream's repository root as the
 * working directory and address fixtures as `packages/<group>/<package>/…`.
 * boat's kernel sits at `dsh/<group>/<package>`, so each test file runs from a
 * directory whose `packages` entry is a link to `dsh/`.
 * @module conformance/upstream-tests/setup
 */

import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const layout = join(repoRoot, 'node_modules/.cache/boat-upstream-layout')
mkdirSync(layout, { recursive: true })
try {
  symlinkSync(join(repoRoot, 'dsh'), join(layout, 'packages'), 'dir')
} catch (error) {
  // Parallel test workers race to create the same link; the first one wins.
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
}
process.chdir(layout)
