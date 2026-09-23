/**
 * G6: a session one side writes, the other side opens and continues exactly as
 * the writer itself would. Each direction resumes the same stored session
 * (`dsh headless --session-id`) twice, once per tree, from copies of the
 * writer's home, and the two continued logs must be equal after normalization.
 */
import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { boatTree, packKernel, vanillaTree } from '../../scripts/dist/trees.ts'
import { cloneRun, freshRun, runScenario, suiteRoot, type OfficialScenario } from '../support/official-cli.ts'

const FILES = { 'README.md': '# roundtrip workspace\n' }
const FIRST: OfficialScenario = {
  name: 'write',
  task: 'read the readme and report',
  sequence: ['tool_call_success', 'success'],
  mock: { toolName: 'read', toolArguments: JSON.stringify({ file_path: 'README.md' }), successText: 'G6-FIRST' },
  files: FILES,
}
const CONTINUE: OfficialScenario = { name: 'continue', task: 'and now summarize', sequence: ['success'], mock: { successText: 'G6-CONTINUED' } }

describe('G6: sessions cross between the official release and boat', () => {
  const trees: Record<'vanilla' | 'boat', string> = { vanilla: '', boat: '' }
  let root: string

  beforeAll(() => {
    trees.vanilla = vanillaTree('conformance')
    trees.boat = boatTree('conformance', packKernel())
    root = suiteRoot('g6')
  }, 600_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it.each([['vanilla', 'boat'], ['boat', 'vanilla']] as const)('%s writes, %s continues as the writer would', async (writer, reader) => {
    const written = await runScenario(trees[writer], FIRST, freshRun(root, `${writer}-writes`, FILES))
    expect(written.code, written.stderr).toBe(0)
    expect(written.sessionId).toBeDefined()
    const sessionId = written.sessionId ?? ''
    const byReader = await runScenario(trees[reader], CONTINUE, cloneRun(written, root, `${writer}-then-${reader}`), ['--session-id', sessionId])
    const byWriter = await runScenario(trees[writer], CONTINUE, cloneRun(written, root, `${writer}-then-${writer}`), ['--session-id', sessionId])
    expect(byReader.code, byReader.stderr).toBe(0)
    expect(byWriter.code, byWriter.stderr).toBe(0)
    expect(byReader.stdout).toContain('G6-CONTINUED')
    expect(byReader.records.length).toBeGreaterThan(written.records.length)
    expect(byReader.normalized).toEqual(byWriter.normalized)
  })
})
