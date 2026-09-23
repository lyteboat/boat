import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { expect, test } from 'vitest'

interface Upstream {
  dsh: string
  cordis: Record<string, string>
}

interface Workspace {
  catalogs: { dsh: Record<string, string>; cordis: Record<string, string> }
}

const upstream = JSON.parse(readFileSync(new URL('../dsh.upstream.json', import.meta.url), 'utf8')) as Upstream
const workspace = parse(readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')) as Workspace

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
