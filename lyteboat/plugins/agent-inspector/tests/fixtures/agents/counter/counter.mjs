// The counter agent's standing scope, as its rows would build it: two tools of
// its own (one always visible, one a skill activates), the inherited tools
// hidden, dynamic routing, and three skills (one requiring a tool no row
// registers, one whose lyteboat metadata does not parse).
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'counter'
export const inject = ['skills', 'skillRouter', 'toolPolicy']

const tool = toolName => defineTool({
  name: toolName,
  description: `${toolName} tool`,
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  execute: async () => toolName,
})

export function apply(ctx) {
  ctx.toolPolicy.declareInherited('hidden')
  ctx.toolPolicy.register(tool('count_clock'), { visibility: 'always' })
  ctx.toolPolicy.register(tool('count_items'), { visibility: 'auto' })
  ctx.skillRouter.declare({ mode: 'dynamic', provider: 'mock', model: 'router' })
  ctx.skills.register({ name: 'item-count', description: 'count the items', content: 'BODY-COUNT', source: 'custom', metadata: { lyteboat: { requiredTools: ['count_items'] } } })
  ctx.skills.register({ name: 'audit-trail', description: 'read the audit trail', whenToUse: 'when asked who changed what', content: 'BODY-AUDIT', source: 'custom', metadata: { lyteboat: { requiredTools: ['count_items', 'missing_tool'] } } })
  ctx.skills.register({ name: 'broken-meta', description: 'metadata that does not parse', content: 'BODY-BROKEN', source: 'custom', metadata: { lyteboat: { requiredTools: 'count_items' } } })
}
