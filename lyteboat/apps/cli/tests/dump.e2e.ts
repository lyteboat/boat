import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runLyteboat } from './support/lyteboat-process.ts'

describe('lyteboat config dump (built bin)', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'lyteboat-dump-home-'))
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('initializes the run profile from lyteboat\'s template and prints its composition', async () => {
    const result = await runLyteboat(['config', 'dump', '--profile', 'run'], { env: { LYTEBOAT_HOME: home } })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('@deepseek-ai/dsh-base')
    expect(result.stdout).toContain('@lyteboat/host')
    expect(result.stdout).toContain('@lyteboat/run')
    expect(result.stdout).toContain('id: agent-loop')
    const manifest = JSON.parse(readFileSync(join(home, 'profiles', 'run', 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    expect(manifest.dsh.profile).toEqual({ bundles: ['@deepseek-ai/dsh-base', '@lyteboat/host', '@lyteboat/run'] })
  })

  it('prints the version pair', async () => {
    const result = await runLyteboat(['--version'], { env: { LYTEBOAT_HOME: home } })
    expect(result.code).toBe(0)
    const { dsh } = JSON.parse(readFileSync(new URL('../../../../dsh.upstream.json', import.meta.url), 'utf8')) as { dsh: string }
    expect(result.stdout).toMatch(/^lyteboat \d+\.\d+\.\d+ \(dsh [^)]+\)\n$/u)
    expect(result.stdout).toContain(`(dsh ${dsh})`)
  })
})
