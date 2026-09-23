import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { expect, test } from 'vitest'

interface Upstream {
  dsh: string
  cordis: Record<string, string>
}

interface Workspace {
  catalogs: { dsh: Record<string, string>; cordis: Record<string, string> }
  overrides: Record<string, string>
}

const upstream = JSON.parse(readFileSync(new URL('../dsh.upstream.json', import.meta.url), 'utf8')) as Upstream
const workspace = parse(readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')) as Workspace
const kernel = Object.keys((JSON.parse(readFileSync(new URL('../dsh/kernel.json', import.meta.url), 'utf8')) as { packages: Record<string, string> }).packages)

test('the dsh catalog pins every entry to the dsh.upstream.json release', () => {
  for (const [name, version] of Object.entries(workspace.catalogs.dsh)) {
    expect({ name, version }).toEqual({ name, version: upstream.dsh })
  }
})

test('the cordis catalog pins every entry to its dsh.upstream.json version', () => {
  for (const [name, version] of Object.entries(workspace.catalogs.cordis)) {
    expect({ name, version }).toEqual({ name, version: upstream.cordis[name] })
  }
})

test('the overrides route exactly the kernel packages to the workspace', () => {
  const routed = Object.entries(workspace.overrides).filter(([, spec]) => spec === 'workspace:*').map(([name]) => name)
  expect(routed.sort()).toEqual([...kernel].sort())
})

test('the dsh catalog lists no kernel package', () => {
  expect(Object.keys(workspace.catalogs.dsh).filter(name => kernel.includes(name))).toEqual([])
})
