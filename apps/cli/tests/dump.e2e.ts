import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runBoat } from './support/boat-process.ts'

describe('boat config dump (built bin)', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'boat-dump-home-'))
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('initializes the run profile from boat\'s template and prints its composition', async () => {
    const result = await runBoat(['config', 'dump', '--profile', 'run'], { env: { BOAT_HOME: home } })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('@deepseek-ai/dsh-base')
    expect(result.stdout).toContain('@boat/host')
    expect(result.stdout).toContain('@boat/run')
    expect(result.stdout).toContain('id: agent-loop')
    const manifest = JSON.parse(readFileSync(join(home, 'profiles', 'run', 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[]; patchReload: string } } }
    expect(manifest.dsh.profile).toEqual({ bundles: ['@deepseek-ai/dsh-base', '@boat/host', '@boat/run'], patchReload: 'startup' })
  })

  it('prints the version pair', async () => {
    const result = await runBoat(['--version'], { env: { BOAT_HOME: home } })
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^boat \d+\.\d+\.\d+ \(dsh 0\.1\.5-alpha\.2\)/u)
  })
})
