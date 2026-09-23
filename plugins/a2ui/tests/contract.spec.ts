/**
 * The component contract: every error keeps its own code, and the client
 * catalog is the caller's to supply.
 */
import { describe, expect, it } from 'vitest'
import { ARK_A2UI_COMPONENT_CATALOG, validateFullPayload, validatePayload } from '@boat/a2ui'

const payload = {
  event: 'beginRendering', version: '1.0.0', surfaceId: 's', rootComponentId: 'c1',
  components: [
    { id: 'c1', component: { Text: { text: {}, children: { explicitList: ['x'] } } } },
    { id: 'c2', component: { Column: { children: { explicitList: ['y'] } } } },
  ],
}

describe('validatePayload', () => {
  it('pairs each error with its own code, so a repeated code after another one is not mislabelled', () => {
    const result = validatePayload(payload)
    expect(result.entries.map(entry => entry.code)).toEqual(['A2UI_COMPONENT_REF_MISSING', 'A2UI_BINDING_XOR', 'A2UI_COMPONENT_REF_MISSING'])
    expect(result.errorCodes).toEqual(['A2UI_COMPONENT_REF_MISSING', 'A2UI_BINDING_XOR'])
    const guard = validateFullPayload(payload)
    expect(guard.errors[2]).toMatch(/^\[A2UI_COMPONENT_REF_MISSING\] Component 'c2' references missing component id: y$/u)
  })

  it('checks bindings against the caller\'s component catalog and reports unknown types instead of rejecting them', () => {
    const warnings: string[] = []
    const log = { warn: (message: string) => { warnings.push(message) } }
    const widget = { rootComponentId: 'w', components: [{ id: 'w', component: { Widget: { label: { path: '' } } } }] }
    expect(validatePayload(widget, log).ok).toBe(true)
    expect(warnings).toEqual(['Unsupported A2UI component type: Widget (component id=w index=0)'])
    const result = validatePayload(widget, log, { types: ['Widget'], bindingFields: { Widget: ['label'] } })
    expect(result.entries).toEqual([{ code: 'A2UI_BINDING_XOR', message: "Component 'w' field 'label' must contain exactly one of 'path' or 'literalString'" }])
    expect(ARK_A2UI_COMPONENT_CATALOG.types).toContain('Text')
  })
})
