import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BoatDistroService from '@boat/distro'

async function mounted(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(BoatDistroService)
  return ctx
}

describe('@boat/distro', () => {
  it('publishes the kernel base and the extensions of this build on ctx.boatDistro', async () => {
    const ctx = await mounted()
    expect(ctx.boatDistro.dsh).toMatch(/^\d+\.\d+\.\d+/u)
    expect(ctx.boatDistro.extensions.map(extension => extension.id)).toContain('agent-loop-intake')
    expect(ctx.boatDistro.extensions.find(extension => extension.id === 'agent-loop-intake')?.package).toBe('@deepseek-ai/dsh-agent-loop')
    expect(ctx.boatDistro.has('agent-loop-pre-assemble')).toBe(true)
  })

  it('answers false for an extension this build does not carry, and its list cannot be changed', async () => {
    const ctx = await mounted()
    expect(ctx.boatDistro.has('session-append-ignorable')).toBe(false)
    expect(Object.isFrozen(ctx.boatDistro.extensions)).toBe(true)
  })

  it('lets a plugin that injects boatDistro load only where the service exists', async () => {
    const ctx = new Context()
    let loaded = false
    ctx.plugin({ name: 'needs-boat', inject: ['boatDistro'], apply: () => { loaded = true } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(loaded).toBe(false)
    await ctx.plugin(BoatDistroService)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(loaded).toBe(true)
  })
})
