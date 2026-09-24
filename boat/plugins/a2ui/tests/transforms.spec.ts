import { describe, expect, it } from 'vitest'
import { execOne, executeTransforms, resolvePath, TransformError, validateEventPayload, validatePayload } from '@boat/a2ui'

const data = {
  total: 1234.5,
  ratio: 0.25,
  items: [
    { name: 'a', amount: 10, kind: 'x' },
    { name: 'b', amount: 20.5, kind: 'y' },
    { name: 'c', amount: 30, kind: 'x' },
  ],
  nested: { list: [{ v: 1 }, { v: 2 }] },
}

describe('resolvePath', () => {
  it('walks dots, indexes and wildcards', () => {
    expect(resolvePath(data, 'nested.list[1].v')).toBe(2)
    expect(resolvePath(data, 'items.name')).toEqual(['a', 'b', 'c'])
    expect(resolvePath(data, 'items.0.name')).toBe('a')
  })

  it('reports missing fields with the reference message', () => {
    expect(() => resolvePath(data, 'nested.missing')).toThrow("字段 'nested.missing' 不存在于数据中 (在 'missing' 处失败, 可用字段: ['list'])")
    expect(() => resolvePath(data, 'total.x')).toThrow(TransformError)
  })
})

describe('execOne', () => {
  it('get with format and default', () => {
    expect(execOne({ get: 'total', format: 'currency' }, data)).toBe('¥ 1,234.50')
    expect(execOne({ get: 'ratio', format: 'percent' }, data)).toBe('25%')
    expect(execOne({ get: 'total', format: 'int' }, data)).toBe('1234')
    expect(execOne({ get: 'nope', default: 'd' }, data)).toBe('d')
    expect(execOne('total', data)).toBe(1234.5)
  })

  it('select with where and map, sum, count, concat, switch', () => {
    expect(execOne({ select: 'items', where: { kind: '== x' }, map: { n: '$.name', amt: { get: '$.amount', format: 'currency' } } }, data))
      .toEqual([{ n: 'a', amt: '¥ 10.00' }, { n: 'c', amt: '¥ 30.00' }])
    expect(execOne({ sum: 'items.amount', where: { amount: '> 15' } }, data)).toBe(50.5)
    expect(execOne({ count: 'items', where: { or: [{ kind: "== 'x'" }, { amount: '>= 20' }] } }, data)).toBe(3)
    expect(execOne({ concat: ['共', { count: 'items' }, '项'] }, data)).toBe('共3项')
    expect(execOne({ switch: 'items[0].kind', cases: { x: 'X!' }, default: '?' }, data)).toBe('X!')
    expect(execOne({ literal: [1] }, data)).toEqual([1])
  })

  it('renders booleans the Python way inside switch keys', () => {
    expect(execOne({ switch: 'flag', cases: { True: 'yes', False: 'no' } }, { flag: true })).toBe('yes')
  })

  it('collects warnings for failed keys and lets later keys read earlier results', () => {
    const { computed, warnings } = executeTransforms({ a: { get: 'total' }, b: { concat: [{ get: 'a' }, '!'] }, c: { get: 'missing' } }, data)
    expect(computed).toEqual({ a: 1234.5, b: '1234.5!' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^\[TRANSFORM_WARN\] c: /u)
  })
})

describe('contract', () => {
  it('validates event shapes with the reference messages', () => {
    expect(() => validateEventPayload({ event: 'beginRendering', surfaceId: 's', rootComponentId: 'r', components: [], catalogId: 'c' })).toThrow('beginRendering requires exactly one of components or catalogId')
    expect(() => validateEventPayload({ event: 'surfaceUpdate', surfaceId: 's', components: [], data: {} })).toThrow("surfaceUpdate contains unsupported fields: ['data']")
    expect(() => validateEventPayload({ event: 'nope' })).toThrow('Unsupported event: nope')
  })

  it('reports duplicate ids, dangling references, binding XOR and root reference', () => {
    const result = validatePayload({ rootComponentId: 'missing', components: [
      { id: 'a', component: { Text: { text: { path: 'p', literalString: 'l' } } } },
      { id: 'a', component: { Row: { children: { explicitList: ['b'] } } } },
    ] })
    expect(result.ok).toBe(false)
    expect(result.errorCodes).toEqual(['A2UI_COMPONENT_ID_DUPLICATE', 'A2UI_BINDING_XOR', 'A2UI_COMPONENT_REF_MISSING', 'A2UI_ROOT_REF_MISSING'])
  })
})
