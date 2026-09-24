import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LyteboatDistroService from '@lyteboat/distro'

async function mounted(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LyteboatDistroService)
  return ctx
}

describe('@lyteboat/distro', () => {
  it('publishes the kernel base and the extensions of this build on ctx.lyteboatDistro', async () => {
    const ctx = await mounted()
    expect(ctx.lyteboatDistro.dsh).toMatch(/^\d+\.\d+\.\d+/u)
    expect(ctx.lyteboatDistro.extensions.map(extension => extension.id)).toContain('agent-loop-intake')
    expect(ctx.lyteboatDistro.extensions.find(extension => extension.id === 'agent-loop-intake')?.package).toBe('@deepseek-ai/dsh-agent-loop')
    expect(ctx.lyteboatDistro.has('agent-loop-pre-assemble')).toBe(true)
  })

  it('answers false for an extension this build does not carry, and its list cannot be changed', async () => {
    const ctx = await mounted()
    expect(ctx.lyteboatDistro.has('no-such-extension')).toBe(false)
    expect(Object.isFrozen(ctx.lyteboatDistro.extensions)).toBe(true)
  })

  it('lets a plugin that injects lyteboatDistro load only where the service exists', async () => {
    const ctx = new Context()
    let loaded = false
    ctx.plugin({ name: 'needs-lyteboat', inject: ['lyteboatDistro'], apply: () => { loaded = true } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(loaded).toBe(false)
    await ctx.plugin(LyteboatDistroService)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(loaded).toBe(true)
  })
})
