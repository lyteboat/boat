import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { LYTEBOAT_RUN_BUNDLES } from '@lyteboat/testing/composition'
import { afterEach, describe, expect, test } from 'vitest'
import { ensureProfileInitialized } from '../src/profile-boot.ts'
import { LYTEBOAT_PROFILE_TEMPLATES } from '../src/templates.ts'

describe('lyteboat profile templates', () => {
  const homes: string[] = []
  const home = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'lyteboat-home-'))
    homes.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  test('a new run profile lists dsh-base, the host bundle, and the run bundle', () => {
    const dir = home()
    ensureProfileInitialized('run', dir)
    const manifest = JSON.parse(readFileSync(join(resolveProfileDir('run', dir), 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    // The layers the composition tests boot as the run profile.
    expect(manifest.dsh.profile.bundles).toEqual(LYTEBOAT_RUN_BUNDLES)
  })

  test('a web profile carries the host bundle too', () => {
    expect(LYTEBOAT_PROFILE_TEMPLATES['web']?.bundles).toEqual(['@deepseek-ai/dsh-base', '@lyteboat/host', '@deepseek-ai/dsh-web-app'])
  })

  test('an existing profile whose bundle list predates the template fails loud with the fix', () => {
    const dir = home()
    initProfile(resolveProfileDir('run', dir), ['@deepseek-ai/dsh-base', '@lyteboat/run'])
    expect(() => { ensureProfileInitialized('run', dir) }).toThrow(/profile "run" .* lists bundles \[@deepseek-ai\/dsh-base, @lyteboat\/run\].*\[@deepseek-ai\/dsh-base, @lyteboat\/host, @lyteboat\/run\]/su)
  })

  test('an existing profile that matches the template boots unchanged', () => {
    const dir = home()
    ensureProfileInitialized('run', dir)
    const file = join(resolveProfileDir('run', dir), 'cordis.patch.yml')
    writeFileSync(file, '- id: session-title-llm\n  disabled: true\n')
    ensureProfileInitialized('run', dir)
    expect(readFileSync(file, 'utf8')).toBe('- id: session-title-llm\n  disabled: true\n')
  })
})
