import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseBoatArgs } from '../src/args.ts'
import { pluginRowId } from '../src/plugins.ts'

const TOOLS_PLUGIN = fileURLToPath(new URL('../../../examples/tools/plugin.mjs', import.meta.url))
const A2UI_PLUGIN = fileURLToPath(new URL('../../../examples/a2ui/plugin.mjs', import.meta.url))

const parse = (argv: string[]) => parseBoatArgs(argv, { boat: '0.0.1', dsh: '0.1.5-alpha.2' })

/** Capture the process exit code while muting Commander's output. */
function exitCode(argv: string[]): number {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    parse(argv)
    throw new Error(`expected ${JSON.stringify(argv)} to exit`)
  } catch {
    return exit.mock.calls.at(-1)?.[0] as number
  } finally {
    vi.restoreAllMocks()
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('parseBoatArgs', () => {
  it('boots the run profile with the task handed to the app verbatim', () => {
    expect(parse(['run', 'summarize', 'this', 'workspace']))
      .toEqual({ mode: 'profile', profile: 'run', driver: 'dsh', plugins: [], patches: [], args: ['summarize', 'this', 'workspace'] })
    expect(parse(['run', '--patch', 'a.yml', '--patch', 'b.yml', 'hello']))
      .toEqual({ mode: 'profile', profile: 'run', driver: 'dsh', plugins: [], patches: ['a.yml', 'b.yml'], args: ['hello'] })
    expect(parse(['run', '--profile', 'custom', 'hello']))
      .toEqual({ mode: 'profile', profile: 'custom', driver: 'dsh', plugins: [], patches: [], args: ['hello'] })
  })

  it('ends the launcher flags at the first token it does not own', () => {
    expect(parse(['run', '-h'])).toEqual({ mode: 'profile', profile: 'run', driver: 'dsh', plugins: [], patches: [], args: ['-h'] })
    expect(parse(['web', '--no-open', '--port', '0']))
      .toEqual({ mode: 'profile', profile: 'web', driver: 'dsh', plugins: [], patches: [], args: ['--no-open', '--port', '0'] })
    expect(parse(['web', '--patch', 'w.yml', '--host', '127.0.0.1', '--patch', 'late.yml']))
      .toEqual({ mode: 'profile', profile: 'web', driver: 'dsh', plugins: [], patches: ['w.yml'], args: ['--host', '127.0.0.1', '--patch', 'late.yml'] })
  })

  it('inserts local plugin files that exist, each once', () => {
    expect(parse(['run', '--plugin', TOOLS_PLUGIN, '--plugin', A2UI_PLUGIN, 'hi']))
      .toEqual({ mode: 'profile', profile: 'run', driver: 'dsh', plugins: [TOOLS_PLUGIN, A2UI_PLUGIN], patches: [], args: ['hi'] })
    expect(exitCode(['run', '--plugin', '', 'hi'])).toBe(1)
    expect(exitCode(['run', '--plugin', 'missing.mjs', 'hi'])).toBe(1)
    expect(exitCode(['run', '--plugin', TOOLS_PLUGIN, '--plugin', TOOLS_PLUGIN, 'hi'])).toBe(1)
  })

  it('selects the agent driver', () => {
    expect(parse(['run', '--driver', 'boat', 'hello']))
      .toEqual({ mode: 'profile', profile: 'run', driver: 'boat', plugins: [], patches: [], args: ['hello'] })
    expect(parse(['web', '--driver', 'boat', '--no-open']))
      .toEqual({ mode: 'profile', profile: 'web', driver: 'boat', plugins: [], patches: [], args: ['--no-open'] })
    expect(parse(['config', 'dump', '--driver', 'boat']))
      .toEqual({ mode: 'dump-config', profile: 'run', driver: 'boat', defaultOnly: false, patches: [], plugins: [] })
    expect(exitCode(['run', '--driver', 'other', 'hello'])).toBe(1)
  })

  it('resolves config dumps', () => {
    expect(parse(['config', 'dump'])).toEqual({ mode: 'dump-config', profile: 'run', driver: 'dsh', defaultOnly: false, patches: [], plugins: [] })
    expect(parse(['config', 'dump', '--profile', 'web', '--default']))
      .toEqual({ mode: 'dump-config', profile: 'web', driver: 'dsh', defaultOnly: true, patches: [], plugins: [] })
    expect(parse(['config', 'dump', '--patch', 'x.yml']))
      .toEqual({ mode: 'dump-config', profile: 'run', driver: 'dsh', defaultOnly: false, patches: ['x.yml'], plugins: [] })
  })

  it('exits on usage errors, help, and version', () => {
    expect(exitCode(['run', '--profile', '', 'x'])).toBe(1)
    expect(exitCode(['run', '--patch', '', 'x'])).toBe(1)
    expect(exitCode(['config', 'dump', '--default', '--patch', 'x.yml'])).toBe(1)
    expect(exitCode(['bogus'])).toBe(1)
    expect(exitCode([])).toBe(1)
    expect(exitCode(['--help'])).toBe(0)
    expect(exitCode(['--version'])).toBe(0)
  })
})

describe('pluginRowId', () => {
  it('names the row after the path, so files sharing a basename get distinct rows', () => {
    expect(pluginRowId('examples/tools/plugin.mjs', '/repo')).toBe('plugin:examples/tools/plugin')
    expect(pluginRowId('/repo/examples/a2ui/plugin.mjs', '/repo')).toBe('plugin:examples/a2ui/plugin')
    expect(pluginRowId('/elsewhere/plugin.mjs', '/repo')).toBe('plugin:/elsewhere/plugin')
  })
})
