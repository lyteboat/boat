import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { LYTEBOAT_HEADLESS_BUNDLES } from '@lyteboat/testing/composition'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { checkSkippedProfileBundles, ensureProfileInitialized } from '../src/profile-boot.ts'
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
    vi.restoreAllMocks()
  })

  test('a new headless profile lists dsh-base, the host bundle, and the headless bundle', () => {
    const dir = home()
    ensureProfileInitialized('headless', dir)
    const manifest = JSON.parse(readFileSync(join(resolveProfileDir('headless', dir), 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    // The layers the composition tests boot as the headless profile.
    expect(manifest.dsh.profile.bundles).toEqual(LYTEBOAT_HEADLESS_BUNDLES)
  })

  test('a web profile carries the host bundle too', () => {
    expect(LYTEBOAT_PROFILE_TEMPLATES['web']?.bundles).toEqual(['@deepseek-ai/dsh-base', '@lyteboat/host', '@deepseek-ai/dsh-web-app'])
  })

  test('an existing profile whose bundle list predates the template fails loud with the fix', () => {
    const dir = home()
    initProfile(resolveProfileDir('headless', dir), ['@deepseek-ai/dsh-base', '@lyteboat/headless'])
    expect(() => { ensureProfileInitialized('headless', dir) }).toThrow(/profile "headless" .* lists bundles \[@deepseek-ai\/dsh-base, @lyteboat\/headless\].*\[@deepseek-ai\/dsh-base, @lyteboat\/host, @lyteboat\/headless\]/su)
  })

  test('an existing profile that matches the template boots unchanged', () => {
    const dir = home()
    ensureProfileInitialized('headless', dir)
    const file = join(resolveProfileDir('headless', dir), 'cordis.patch.yml')
    writeFileSync(file, '- id: session-title-llm\n  disabled: true\n')
    ensureProfileInitialized('headless', dir)
    expect(readFileSync(file, 'utf8')).toBe('- id: session-title-llm\n  disabled: true\n')
  })

  test('a profile that dsh loaded without a bundle its template lists fails with the bundle and the reason', () => {
    const profile = { skippedBundles: [{ packageName: '@lyteboat/host', reason: 'Error: incompatible dsh peers' }] }
    expect(() => { checkSkippedProfileBundles('headless', profile) })
      .toThrow('lyteboat: profile "headless" cannot boot without the bundles its template lists; skipped: @lyteboat/host (Error: incompatible dsh peers)')
  })

  test('a profile without a lyteboat template reports a skipped bundle and boots on', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    checkSkippedProfileBundles('custom', { skippedBundles: [{ packageName: '@example/extra', reason: 'Error: not installed' }] })
    expect(stderr).toHaveBeenCalledWith('lyteboat: skipping profile bundle "@example/extra": Error: not installed\n')
  })
})
