/**
 * The bundle loader fails loud on authoring mistakes a blank card would hide.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadBundle } from '@boat/a2ui'

const TEMPLATE = '{"rootComponentId":"root","components":[{"id":"root","component":{"Column":{}}}]}'
const roots: string[] = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

function card(files: Record<string, string>): { root: string; card: string } {
  const root = mkdtempSync(join(tmpdir(), 'a2ui-loader-'))
  roots.push(root)
  mkdirSync(join(root, 'card'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'card', name), text)
  return { root, card: 'card' }
}

describe('loadBundle', () => {
  it('loads a card whose manifest is absent or empty', async () => {
    const { root } = card({ 'template.json': TEMPLATE, 'manifest.yaml': '# nothing yet\n' })
    const bundle = await loadBundle(root, 'card')
    expect(bundle.manifest).toEqual({})
    expect(bundle.argSpecs).toEqual({})
  })

  it('rejects a manifest that is a list instead of a mapping, naming the file', async () => {
    const { root } = card({ 'template.json': TEMPLATE, 'manifest.yaml': '- paths:\n    title:\n      kind: state\n' })
    await expect(loadBundle(root, 'card')).rejects.toThrow(/manifest\.yaml 必须是 YAML 映射，实际是 list/u)
  })

  it('rejects manifest paths, manifest args and hierarchies that are not mappings', async () => {
    const paths = card({ 'template.json': TEMPLATE, 'manifest.yaml': 'paths:\n  - title\n' })
    await expect(loadBundle(paths.root, 'card')).rejects.toThrow(/manifest\.yaml 的 paths 必须是映射/u)
    const args = card({ 'template.json': TEMPLATE, 'manifest.yaml': 'args: bucket\n' })
    await expect(loadBundle(args.root, 'card')).rejects.toThrow(/manifest\.yaml 的 args 必须是映射，实际是 string/u)
    const hierarchies = card({ 'template.json': TEMPLATE, 'business_hierarchy.yaml': 'hierarchies:\n  - brief\n' })
    await expect(loadBundle(hierarchies.root, 'card')).rejects.toThrow(/business_hierarchy\.yaml 的 hierarchies 必须是映射/u)
  })

  it('rejects a template that is not JSON or has no components list', async () => {
    const broken = card({ 'template.json': '{ not json' })
    await expect(loadBundle(broken.root, 'card')).rejects.toThrow(/template\.json 不是合法 JSON/u)
    const bare = card({ 'template.json': '{"rootComponentId":"root"}' })
    await expect(loadBundle(bare.root, 'card')).rejects.toThrow(/template\.json 必须是带 components 列表的对象/u)
  })
})
