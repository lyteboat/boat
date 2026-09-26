import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installLyteboatHome } from '../src/home.ts'

describe('installLyteboatHome', () => {
  it('exports LYTEBOAT_HOME as DSH_HOME and its .agents as DSH_AGENTS_HOME, over values already set', () => {
    const env: Record<string, string | undefined> = { LYTEBOAT_HOME: '/srv/lyteboat', DSH_HOME: '/home/u/.dsh', DSH_AGENTS_HOME: '/home/u/.agents' }

    const home = installLyteboatHome(env)

    expect(home).toBe('/srv/lyteboat')
    expect(env['DSH_HOME']).toBe('/srv/lyteboat')
    expect(env['DSH_AGENTS_HOME']).toBe('/srv/lyteboat/.agents')
  })

  it('falls back to ~/.lyteboat when LYTEBOAT_HOME is blank', () => {
    const env: Record<string, string | undefined> = { LYTEBOAT_HOME: '  ' }

    const home = installLyteboatHome(env)

    expect(home).toBe(join(homedir(), '.lyteboat'))
    expect(env['DSH_AGENTS_HOME']).toBe(join(home, '.agents'))
  })
})
