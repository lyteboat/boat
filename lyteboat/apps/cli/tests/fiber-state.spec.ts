import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIBER_STATE } from '../src/fiber-state.ts'

/** Parse `export declare const enum FiberState { A = 0, ... }` from the installed declaration file. */
function declaredFiberState(): Record<string, number> {
  const require = createRequire(import.meta.url)
  const packageJson = require.resolve('@deepseek-ai/cordis/package.json')
  const source = readFileSync(join(dirname(packageJson), 'lib', 'types', 'fiber.d.ts'), 'utf8')
  const body = /const enum FiberState \{([^}]*)\}/u.exec(source)?.[1]
  if (body === undefined) throw new Error('FiberState enum not found in cordis fiber.d.ts')
  const members: Record<string, number> = {}
  for (const match of body.matchAll(/(\w+)\s*=\s*(\d+)/gu)) members[match[1]!] = Number(match[2])
  return members
}

describe('FIBER_STATE', () => {
  it('mirrors every member of the installed cordis FiberState declaration', () => {
    expect({ ...FIBER_STATE }).toEqual(declaredFiberState())
  })
})
