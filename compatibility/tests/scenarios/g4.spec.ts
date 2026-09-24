/**
 * G4: for the same scripted model, the official release and the same release
 * with lyteboat's kernel write the same session log, event for event after
 * normalization, and print the same answer. The trees differ in the kernel
 * packages only (scripts/dist/trees.ts), so a difference is the kernel's.
 */
import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lyteboatTree, packKernel, vanillaTree } from '../../../scripts/dist/trees.ts'
import { freshRun, runScenario, suiteRoot } from '../support/official-cli.ts'
import { G4_SCENARIOS } from './scenarios.ts'

describe('G4: the official release and lyteboat write the same session log', () => {
  let vanilla: string
  let lyteboat: string
  let root: string

  beforeAll(() => {
    vanilla = vanillaTree('compatibility')
    lyteboat = lyteboatTree('compatibility', packKernel())
    root = suiteRoot('g4')
  }, 600_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it.each(G4_SCENARIOS.map(scenario => [scenario.name, scenario] as const))('%s', async (_name, scenario) => {
    const official = await runScenario(vanilla, scenario, freshRun(root, `${scenario.name}-vanilla`, scenario.files))
    const ours = await runScenario(lyteboat, scenario, freshRun(root, `${scenario.name}-lyteboat`, scenario.files))
    expect(official.records.length, official.stderr).toBeGreaterThan(1)
    expect(ours.code, ours.stderr).toBe(official.code)
    expect(ours.requests).toBe(official.requests)
    expect(ours.stdout).toBe(official.stdout)
    expect(ours.normalized).toEqual(official.normalized)
  })
})
