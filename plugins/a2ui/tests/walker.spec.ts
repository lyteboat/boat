/** The reference synthetic walker tests (tests/unit/core/test_template_engine.py), ported. */
import { describe, expect, it } from 'vitest'
import { BoundPathTracker, walk, rowTemplateIds, validateFullPayload } from '@boat/a2ui'
import type { TemplateDocument } from '@boat/a2ui'

const component = (id: string, type: string, props: Record<string, unknown>) => ({ id, component: { [type]: props } })
type Props = Record<string, unknown>
const byId = (payload: Record<string, unknown>, id: string): Record<string, Props> =>
  (payload['components'] as { id: string; component: Record<string, Props> }[]).find(entry => entry.id === id)!.component
const ids = (payload: Record<string, unknown>): string[] => (payload['components'] as { id: string }[]).map(entry => entry.id)

describe('walk', () => {
  it('fans a binding dataSource out once per item with unique ids and drops dataSource/child', () => {
    const template: TemplateDocument = { rootComponentId: 'list', components: [
      component('list', 'List', { dataSource: { path: 'rows' }, child: 'row' }),
      component('row', 'Row', { children: { explicitList: ['cell'] } }),
      component('cell', 'Text', { text: { path: 'label' } }),
    ] }
    const warnings: string[] = []
    const payload = walk(template, new BoundPathTracker({ rows: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }), { root: 'list', ui_ids: null }, { warn: message => warnings.push(message) })
    const list = byId(payload, 'list')['List']!
    const fanIds = (list['children'] as { explicitList: string[] }).explicitList
    expect(fanIds).toHaveLength(3)
    expect(new Set(fanIds).size).toBe(3)
    expect(list).not.toHaveProperty('dataSource')
    expect(list).not.toHaveProperty('child')
    const labels = ids(payload).filter(id => id.startsWith('cell')).map(id => (byId(payload, id)['Text']!['text'] as { literalString: string }).literalString)
    expect(new Set(labels)).toEqual(new Set(['A', 'B', 'C']))
    expect(warnings).toEqual([])
  })

  it('yields no children for an empty array and warns for a non-list dataSource', () => {
    const template: TemplateDocument = { rootComponentId: 'list', components: [
      component('list', 'List', { dataSource: { path: 'rows' }, child: 'row' }),
      component('row', 'Text', { text: { path: 'label' } }),
    ] }
    expect((byId(walk(template, new BoundPathTracker({ rows: [] }), { root: 'list', ui_ids: null }), 'list')['List']!['children'] as { explicitList: string[] }).explicitList).toEqual([])
    const warnings: string[] = []
    const payload = walk(template, new BoundPathTracker({ rows: 'not-a-list' }), { root: 'list', ui_ids: null }, { warn: message => warnings.push(message) })
    expect((byId(payload, 'list')['List']!['children'] as { explicitList: string[] }).explicitList).toEqual([])
    expect(warnings[0]).toContain('无法 fan-out')
    expect(warnings[0]).toContain("'list'")
  })

  it('deep-resolves a path nested under action.args.data to its raw value', () => {
    const template: TemplateDocument = { rootComponentId: 'btn', components: [
      component('btn', 'Button', { text: { literalString: 'i' }, action: { name: 'openPopup', args: { catalogId: 'popup', data: { path: 'detail' } } } }),
    ] }
    const detail = { title: '日常明细', items: [{ name: 'A', amount: '¥1' }] }
    const payload = walk(template, new BoundPathTracker({ detail }), { root: 'btn', ui_ids: null })
    const action = byId(payload, 'btn')['Button']!['action'] as { args: { catalogId: string; data: unknown } }
    expect(action.args.catalogId).toBe('popup')
    expect(action.args.data).toEqual(detail)
  })

  it('resolves a nested dataSource against the outer item scope', () => {
    const template: TemplateDocument = { rootComponentId: 'outer', components: [
      component('outer', 'List', { dataSource: { path: 'groups' }, child: 'grow' }),
      component('grow', 'List', { dataSource: { path: 'children' }, child: 'leaf' }),
      component('leaf', 'Text', { text: { path: 'label' } }),
    ] }
    const payload = walk(template, new BoundPathTracker({ groups: [{ children: [{ label: 'A1' }, { label: 'A2' }] }, { children: [{ label: 'B1' }] }] }), { root: 'outer', ui_ids: null })
    const labels = ids(payload).filter(id => id.startsWith('leaf')).map(id => (byId(payload, id)['Text']!['text'] as { literalString: string }).literalString)
    expect(new Set(labels)).toEqual(new Set(['A1', 'A2', 'B1']))
  })

  it('passes a literalString-wrapped dataSource through with its row subtree unresolved', () => {
    const template: TemplateDocument = { rootComponentId: 'clist', components: [
      component('clist', 'CollapseList', { limit: 2, child: 'row', dataSource: { literalString: { path: 'rows' } } }),
      component('row', 'Row', { children: { explicitList: ['cell-name', 'cell-amount'] } }),
      component('cell-name', 'Text', { text: { path: 'name' } }),
      component('cell-amount', 'Text', { text: { path: 'amount' } }),
    ] }
    const rows = [{ name: 'A', amount: '¥1' }, { name: 'B', amount: '¥2' }]
    const payload = walk(template, new BoundPathTracker({ rows }), { root: 'clist', ui_ids: null })
    const props = byId(payload, 'clist')['CollapseList']!
    expect(props['child']).toBe('row')
    expect(props['dataSource']).toEqual({ literalString: rows })
    expect(props).not.toHaveProperty('children')
    expect(ids(payload).some(id => id.startsWith('row__'))).toBe(false)
    expect(new Set(ids(payload))).toEqual(new Set(['clist', 'row', 'cell-name', 'cell-amount']))
    expect(byId(payload, 'cell-name')['Text']!['text']).toEqual({ path: 'name' })
    expect(rowTemplateIds(payload)).toEqual(new Set(['row', 'cell-name', 'cell-amount']))
    const guard = validateFullPayload({ event: 'beginRendering', version: '1.0.0', surfaceId: 's', ...payload }, { strict: false })
    expect(guard.warnings.some(warning => warning.includes('DATA_COVERAGE'))).toBe(false)
  })

  it('records the flat keys the walk bound', () => {
    const template: TemplateDocument = { rootComponentId: 't', components: [
      component('t', 'Text', { text: { path: 'a' }, hide: { path: 'gone' } }),
    ] }
    const tracker = new BoundPathTracker({ a: 'x', b: 'unused', gone: false })
    walk(template, tracker, { root: 't', ui_ids: null })
    expect(tracker.boundPaths).toEqual(new Set(['a', 'gone']))
  })
})
