// Adds data.agent_tag to every frame of this agent's answers, as an agent's own
// frame decorator would add a field its callers read.
export const name = 'serve-fixture-frame-tag'

export const inject = ['chatApi']

export function apply(ctx) {
  ctx.chatApi.registerFrameDecorator(frame => ({ ...frame, data: { ...frame.data, agent_tag: 'alpha' } }))
}
