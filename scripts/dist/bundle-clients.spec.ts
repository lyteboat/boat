import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { DSH_WEB_PLATFORM_MODULES, lyteboatClientPackages } from './bundle-clients.ts'
import { repoRoot } from './kernel.ts'

test('the platform modules are the ones the tracked dsh web shell shares', () => {
  const declaration = readFileSync(join(repoRoot, 'node_modules/@deepseek-ai/dsh-client-web/lib/types/platform.d.ts'), 'utf8')
  const list = /PLATFORM_MODULES: readonly \[([^\]]*)\]/u.exec(declaration)?.[1] ?? ''

  expect([...list.matchAll(/"([^"]+)"/gu)].map(match => match[1])).toEqual(DSH_WEB_PLATFORM_MODULES)
})

test('lyteboatClientPackages finds the packages whose manifests declare dsh.client', () => {
  expect(lyteboatClientPackages().map(pkg => pkg.name)).toEqual(['@lyteboat/web-pages'])
})
