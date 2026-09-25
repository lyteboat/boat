/**
 * G4 fixture: a plugin that changes the agent's tool set between two model
 * requests of one turn, through the public tool and system-prompt registries
 * only. Each fixed tool comes with its own prompt section, as dsh's tool
 * plugins do. `g4_switch_tools` removes `g4_retired` and adds `g4_added`, so
 * the next request carries one tool addition, one tool removal, and a changed
 * system prompt. It imports nothing: the official CLI loads it by path, and a
 * package import would resolve from this repository instead of the install
 * tree under test.
 */

export const name = 'g4-tool-switch'
export const inject = ['tools', 'systemPrompt']

/** Register a parameterless tool that answers `answer`, and its prompt section; returns one disposer for both. */
function mountFixedTool(ctx, toolName, answer) {
  const unregister = ctx.tools.register({
    name: toolName,
    description: `Answers "${answer}".`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => answer,
  })
  const unsection = ctx.systemPrompt.section({ name: toolName, order: 500, text: `Call ${toolName} only when asked to.` })
  return () => {
    unsection()
    unregister()
  }
}

export function apply(ctx) {
  const unmountRetired = mountFixedTool(ctx, 'g4_retired', 'retired')
  ctx.tools.register({
    name: 'g4_switch_tools',
    description: 'Replace g4_retired with g4_added.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => {
      unmountRetired()
      mountFixedTool(ctx, 'g4_added', 'added')
      return 'switched'
    },
  })
}
