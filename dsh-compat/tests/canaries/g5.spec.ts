/**
 * G5: pinned community plugins, installed the way users install them
 * (`dsh plugin --profile headless add <pkg>@<version>`), run the same scripted
 * task on the official release and on lyteboat's kernel. Each canary was admitted
 * only after it ran clean on the official release (canaries.yml records how it
 * was chosen); on lyteboat it must run clean too, print the same answer, and write
 * the same session log. The profile install must hold no copy of a kernel
 * package: a runtime-installed plugin binds to the host's kernel, lyteboat's.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { kernelPackages } from '../../../scripts/dist/kernel.ts'
import { lyteboatTree, packKernel, vanillaTree } from '../../../scripts/dist/trees.ts'
import { freshRun, runDsh, runScenario, suiteRoot, type OfficialRun } from '../support/official-cli.ts'

interface Canary {
  name: string
  version: string
  /** A plugin without a dsh.bundle is installed as a plain dependency and needs a row. */
  bundle: boolean
  risk: string
}

const canaries = (parse(readFileSync(new URL('./canaries.yml', import.meta.url), 'utf8')) as { canaries: Canary[] }).canaries

/** Kernel packages the profile install carries itself, instead of taking the host's. */
function kernelCopiesInProfile(home: string): string[] {
  const store = join(home, 'profiles', 'headless', 'node_modules', '.pnpm')
  if (!existsSync(store)) return []
  const prefixes = kernelPackages().map(({ name }) => `${name.replace('/', '+')}@`)
  return readdirSync(store).filter(entry => prefixes.some(prefix => entry.startsWith(prefix)))
}

async function runCanary(tree: string, canary: Canary, root: string, label: string): Promise<OfficialRun> {
  const place = freshRun(root, label, { 'README.md': '# canary workspace\n' })
  const install = await runDsh(tree, ['plugin', '--profile', 'headless', 'add', `${canary.name}@${canary.version}`], {
    cwd: place.home,
    env: { ...process.env, DSH_HOME: place.home, DSH_TELEMETRY_DISABLED: '1' },
  })
  expect(install.code, install.stderr).toBe(0)
  const patch = canary.bundle ? '' : `- insert:\n    - id: canary\n      name: '${canary.name}'\n`
  return runScenario(tree, { name: canary.name, task: 'say hello', sequence: ['success'], mock: { successText: 'G5-OK', repeatLast: true }, patch }, place)
}

describe('G5: community canaries run the same on the official release and on lyteboat', () => {
  let vanilla: string
  let lyteboat: string
  let root: string

  beforeAll(() => {
    vanilla = vanillaTree('dsh-compat')
    lyteboat = lyteboatTree('dsh-compat', packKernel())
    root = suiteRoot('g5')
  }, 600_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it.each(canaries.map(canary => [`${canary.name}@${canary.version} (${canary.risk})`, canary] as const))('%s', async (_label, canary) => {
    const slug = canary.name.replace(/[@/]/gu, '_')
    const official = await runCanary(vanilla, canary, root, `${slug}-vanilla`)
    const ours = await runCanary(lyteboat, canary, root, `${slug}-lyteboat`)
    expect(official.code, official.stderr).toBe(0)
    expect(official.stderr).not.toContain('did not activate')
    expect(ours.code, ours.stderr).toBe(0)
    expect(ours.stderr).not.toContain('did not activate')
    expect(kernelCopiesInProfile(ours.home)).toEqual([])
    expect(ours.stdout).toBe(official.stdout)
    expect(ours.normalized).toEqual(official.normalized)
  })
})
