import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseBoatArgs } from '../src/args.ts'

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
      .toEqual({ mode: 'profile', profile: 'run', patches: [], args: ['summarize', 'this', 'workspace'] })
    expect(parse(['run', '--patch', 'a.yml', '--patch', 'b.yml', 'hello']))
      .toEqual({ mode: 'profile', profile: 'run', patches: ['a.yml', 'b.yml'], args: ['hello'] })
    expect(parse(['run', '--profile', 'custom', 'hello']))
      .toEqual({ mode: 'profile', profile: 'custom', patches: [], args: ['hello'] })
  })

  it('ends the launcher flags at the first token it does not own', () => {
    expect(parse(['run', '-h'])).toEqual({ mode: 'profile', profile: 'run', patches: [], args: ['-h'] })
    expect(parse(['web', '--no-open', '--port', '0']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--no-open', '--port', '0'] })
    expect(parse(['web', '--patch', 'w.yml', '--host', '127.0.0.1', '--patch', 'late.yml']))
      .toEqual({ mode: 'profile', profile: 'web', patches: ['w.yml'], args: ['--host', '127.0.0.1', '--patch', 'late.yml'] })
  })

  it('resolves config dumps', () => {
    expect(parse(['config', 'dump'])).toEqual({ mode: 'dump-config', profile: 'run', defaultOnly: false, patches: [] })
    expect(parse(['config', 'dump', '--profile', 'web', '--default']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
    expect(parse(['config', 'dump', '--patch', 'x.yml']))
      .toEqual({ mode: 'dump-config', profile: 'run', defaultOnly: false, patches: ['x.yml'] })
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
