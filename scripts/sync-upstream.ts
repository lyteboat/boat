/**
 * Copy the forked dsh sources from a checkout of the pinned tag into boat's
 * packages, applying only the identity rewrites listed below. Run after
 * bumping dsh.upstream.json and checking out the new tag:
 *
 *   node --import tsx scripts/sync-upstream.ts /path/to/deepseek-harness
 *
 * The copy is deliberately dumb so that `git diff` after a re-sync shows
 * exactly what upstream changed. Behavioral changes boat makes to the fork
 * live in the boat tree and are re-applied by hand from that diff; the files
 * boat owns outright (`keep`) are never overwritten or deleted. Each forked
 * package's `UPSTREAM.md` is hand-maintained and lists the divergence.
 * @module scripts/sync-upstream
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const upstream = JSON.parse(readFileSync(join(repoRoot, 'dsh.upstream.json'), 'utf8')) as { dsh: string; tag: string; commit: string }

/** One forked directory: where it comes from in the dsh checkout and where it lands in boat. */
interface ForkTarget {
  source: string
  target: string
  /** Files (relative to `target`) boat owns: kept as they are, whether or not upstream has a file of that name. */
  keep?: readonly string[]
}

const TARGETS: readonly ForkTarget[] = [
  { source: 'packages/core/agent-loop/src', target: 'boat/core/agentic-loop/src' },
  {
    source: 'packages/core/agent-loop/tests',
    target: 'boat/core/agentic-loop/tests',
    keep: ['boat-intake.spec.ts', 'support/live-config.ts', 'support/pi-context.ts', 'support/source-kinds.ts'],
  },
  { source: 'packages/test-support/agent-loop-testkit/src', target: 'boat/tooling/dsh-agent-loop-testkit-fork/src' },
]

/**
 * Identity rewrites, applied to every copied file. Package names and the
 * effect label are the only strings that change; `agent-loop/config-start-failed`
 * (an event name) is a seam other dsh packages depend on and must stay.
 */
const REWRITES: readonly [RegExp, string][] = [
  [/@deepseek-ai\/dsh-agent-loop-testkit/gu, '@boat/dsh-agent-loop-testkit-fork'],
  [/@deepseek-ai\/dsh-agent-loop/gu, '@boat/agentic-loop'],
  [/'agentLoop\.setFactory\(\)'/gu, "'boatAgenticLoop.setFactory()'"],
  // The published cordis build erases the FiberState const enum; boat reads the values
  // through @boat/cordis-compat (tsconfig isolatedModules rejects the direct read).
  [/import \{ Context, FiberState, Service \} from '@deepseek-ai\/cordis'\n/u,
    "import { Context, Service } from '@deepseek-ai/cordis'\nimport type { FiberState } from '@deepseek-ai/cordis'\nimport { FIBER_STATE } from '@boat/cordis-compat'\n"],
  [/\bFiberState\.(UNLOADING|DISPOSED|FAILED|ACTIVE|PENDING|LOADING)\b/gu, 'FIBER_STATE.$1'],
]

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map(entry => join(dir, entry))
    .filter(path => path.endsWith('.ts'))
    .sort()
}

function main(): void {
  const checkout = process.argv[2]
  if (checkout === undefined) throw new Error('usage: sync-upstream.ts <path to deepseek-harness checkout>')
  const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (head !== upstream.commit) {
    throw new Error(`checkout is at ${head}, dsh.upstream.json pins ${upstream.commit} (${upstream.tag}); check out the tag first`)
  }
  for (const { source, target, keep = [] } of TARGETS) {
    const sourceDir = resolve(checkout, source)
    const targetDir = resolve(repoRoot, target)
    const kept = new Map<string, string>()
    for (const file of keep) {
      try {
        kept.set(file, readFileSync(join(targetDir, file), 'utf8'))
      } catch {
        // A kept file boat has not written yet: nothing to preserve.
      }
    }
    rmSync(targetDir, { recursive: true, force: true })
    let copied = 0
    for (const file of listFiles(sourceDir)) {
      const rel = relative(sourceDir, file)
      if (kept.has(rel)) continue
      const destination = join(targetDir, rel)
      mkdirSync(join(destination, '..'), { recursive: true })
      let text = readFileSync(file, 'utf8')
      for (const [pattern, replacement] of REWRITES) text = text.replace(pattern, replacement)
      writeFileSync(destination, text)
      copied += 1
    }
    for (const [rel, text] of kept) {
      const destination = join(targetDir, rel)
      mkdirSync(join(destination, '..'), { recursive: true })
      writeFileSync(destination, text)
    }
    console.log(`${target}: ${String(copied)} files from ${source}, ${String(kept.size)} kept; re-apply the divergence listed in ${target.split('/').slice(0, 3).join('/')}/UPSTREAM.md`)
  }
}

main()
