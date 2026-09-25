/**
 * Field-by-field fidelity against payloads the reference engine produced for the same
 * templates and raw data (fixtures/baseline, generated from the reference implementation at fa43a58
 * with the fixture of tests/unit/core/test_template_engine.py).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateFullPayload } from '../src/contract.ts'
import { TemplateEngine, TemplateModeError, mintSurfaceId } from '../src/engine.ts'
import { REFERENCE_A2UI_COMPONENT_CATALOG } from './fixtures/reference-component-catalog.ts'

const ROOT = fileURLToPath(new URL('./fixtures/templates', import.meta.url))
const BASELINE = fileURLToPath(new URL('./fixtures/baseline', import.meta.url))

interface Baseline {
  card: string
  raw: Record<string, unknown>
  hierarchy: string | null
  sessionId: string
  surfaceId: string
  payload: Record<string, unknown>
  warnings: string[]
  digest: string
  stateDelta: Record<string, unknown> | null
  guard: { ok: boolean; errors: string[]; warnings: string[] }
}

const baselines = readdirSync(BASELINE).filter(name => name.endsWith('.json')).sort()
  .map(name => [name.replace(/\.json$/u, ''), JSON.parse(readFileSync(join(BASELINE, name), 'utf8')) as Baseline] as const)

describe('TemplateEngine against reference baselines', () => {
  it.each(baselines)('%s renders the same payload, digest and warnings', async (_name, baseline) => {
    const engine = new TemplateEngine(ROOT)
    const result = await engine.render(baseline.card, baseline.raw, {
      hierarchy: baseline.hierarchy ?? undefined,
      sessionId: baseline.sessionId,
      surfaceId: baseline.surfaceId,
    })
    const expected = { ...baseline.payload }
    const actual = { ...result.payload }
    if (baseline.surfaceId === '') {
      // A fresh surface carries a random suffix on both sides; the shape is the reference `<card>-<session[:8]>-<hex6>`.
      expect(actual['surfaceId']).toMatch(new RegExp(`^${baseline.card}-sess-123-[0-9a-f]{6}$`, 'u'))
      delete expected['surfaceId']
      delete actual['surfaceId']
    }
    expect(actual).toEqual(expected)
    expect(result.digest).toBe(baseline.digest)
    // The reference produced no state delta for these cards; the port has no stateDelta hook.
    expect(baseline.stateDelta).toBeNull()
    expect(result).not.toHaveProperty('stateDelta')
    expect(result.warnings).toEqual(baseline.warnings)
    const guard = validateFullPayload(result.payload, { strict: true, catalog: REFERENCE_A2UI_COMPONENT_CATALOG })
    expect(guard.ok).toBe(baseline.guard.ok)
    expect(guard.errors).toEqual(baseline.guard.errors)
    expect(guard.warnings).toEqual(baseline.guard.warnings)
  })

  it('lists cards, hierarchies and arg specs', async () => {
    const engine = new TemplateEngine(ROOT)
    expect(engine.cards()).toEqual(['asset_overview', 'unauthorized'])
    expect(await engine.hierarchies('asset_overview')).toEqual(['asset_overview'])
    expect(await engine.argSpecs('unauthorized')).toEqual({})
  })

  it('rejects an unknown hierarchy and an unknown card', async () => {
    const engine = new TemplateEngine(ROOT)
    await expect(engine.render('asset_overview', {}, { hierarchy: 'nope' })).rejects.toThrow(TemplateModeError)
    await expect(engine.render('missing', {})).rejects.toThrow(/template 卡目录不存在/u)
  })

  it('mints reference-shaped surface ids', () => {
    expect(mintSurfaceId('asset_overview', 'session-abcdef12345')).toMatch(/^asset_overview-session--[0-9a-f]{6}$/u)
  })
})
