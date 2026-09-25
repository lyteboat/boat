/**
 * Template-mode rendering: load → resolve the manifest → walk → business
 * payload → surface identity → the digest hook. A port of the reference implementation's
 * template_engine/engine.py. The payload is literal-only and frontend-ready.
 * @module @lyteboat/a2ui/engine
 */

import { randomBytes } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import type { LyteboatCardEmission } from '@lyteboat/contracts'
import { BUSINESS_PAYLOAD_KEY, templateBusinessPayload } from './business-payload.ts'
import { isCardDir, loadBundle } from './loader.ts'
import type { TemplateBundle } from './loader.ts'
import { resolveManifest } from './resolver.ts'
import type { A2uiLog, RawData } from './transforms.ts'
import { SILENT_LOG } from './transforms.ts'
import { BoundPathTracker, walk } from './walker.ts'
import type { HierarchyShape } from './walker.ts'

/** A render that cannot proceed: unknown card or hierarchy. */
export class TemplateModeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateModeError'
  }
}

export interface TemplateRenderResult {
  payload: Record<string, unknown>
  warnings: string[]
  digest: string
  /** When the card is shown: its manifest's `emission_mode`, `immediate` when it declares none. */
  emission: LyteboatCardEmission
}

export interface TemplateRenderOptions {
  hierarchy?: string | undefined
  sessionId?: string | undefined
  /** An existing surface: render as an in-place `surfaceUpdate` instead of a new `beginRendering`. */
  surfaceId?: string | undefined
}

/** beginRendering-only top-level fields are illegal on surfaceUpdate; an in-place refresh keeps these. */
const SURFACE_UPDATE_FIELDS = ['version', 'rootComponentId', 'components', 'exposureData', BUSINESS_PAYLOAD_KEY]

function asSurfaceUpdate(payload: Record<string, unknown>, surfaceId: string): Record<string, unknown> {
  const out: Record<string, unknown> = { event: 'surfaceUpdate', surfaceId }
  for (const key of SURFACE_UPDATE_FIELDS) if (key in payload) out[key] = payload[key]
  return out
}

/** Render cards from one templates root; the bundles it loads live as long as the engine. */
export class TemplateEngine {
  private readonly bundles = new Map<string, TemplateBundle>()

  constructor(readonly root: string, private readonly log: A2uiLog = SILENT_LOG) {}

  /** Card names: every directory under the root that holds a template.json, sorted. */
  cards(): string[] {
    let entries: string[]
    try {
      if (!statSync(this.root).isDirectory()) return []
      entries = readdirSync(this.root)
    } catch {
      return []
    }
    return entries.filter(name => isCardDir(this.root, name)).sort()
  }

  /** The hierarchy variants the model may select for a card. */
  async hierarchies(card: string): Promise<string[]> {
    const bundle = await loadBundle(this.root, card, this.bundles)
    const names = Object.keys(bundle.hierarchies).sort()
    return names.length > 0 ? names : [bundle.defaultHierarchy]
  }

  /** The model-facing input schema of a card (`manifest.args`). */
  async argSpecs(card: string): Promise<Record<string, Record<string, unknown>>> {
    return (await loadBundle(this.root, card, this.bundles)).argSpecs
  }

  /** `manifest.emission_mode`, or undefined when the card declares none. */
  async emissionMode(card: string): Promise<LyteboatCardEmission | undefined> {
    return (await loadBundle(this.root, card, this.bundles)).emissionMode
  }

  /**
   * Render one card.
   * @param card - the card name.
   * @param raw - the raw data namespace.
   * @param options - hierarchy, session and surface identity.
   */
  async render(card: string, raw: RawData, options: TemplateRenderOptions = {}): Promise<TemplateRenderResult> {
    const bundle = await loadBundle(this.root, card, this.bundles)
    const hierarchy = this.resolveHierarchy(bundle, options.hierarchy)
    const { flat, warnings } = resolveManifest(bundle.manifest, raw, bundle.compute, this.log)
    const tracked = new BoundPathTracker(flat)
    let payload = walk(bundle.template, tracked, hierarchy, this.log)
    const business = templateBusinessPayload(flat, tracked.boundPaths, this.log)
    if (Object.keys(business).length > 0) payload[BUSINESS_PAYLOAD_KEY] = business
    const surfaceId = (options.surfaceId ?? '').trim()
    if (surfaceId !== '') payload = asSurfaceUpdate(payload, surfaceId)
    else payload['surfaceId'] = mintSurfaceId(card, options.sessionId ?? '')
    return { payload, warnings, digest: this.digest(bundle, raw, flat), emission: bundle.emissionMode ?? 'immediate' }
  }

  private resolveHierarchy(bundle: TemplateBundle, name: string | undefined): HierarchyShape {
    const chosen = name !== undefined && name !== '' ? name : bundle.defaultHierarchy
    const hierarchy = bundle.hierarchies[chosen]
    if (hierarchy === undefined) {
      if (name === undefined || name === '') return { root: bundle.template.rootComponentId, ui_ids: null }
      throw new TemplateModeError(`卡 '${bundle.name}' 无 business_hierarchy '${name}'。可选: [${Object.keys(bundle.hierarchies).sort().map(key => `'${key}'`).join(', ')}]`)
    }
    return { root: hierarchy.root ?? bundle.template.rootComponentId, ui_ids: hierarchy.ui_ids }
  }

  private digest(bundle: TemplateBundle, raw: RawData, flat: Record<string, unknown>): string {
    if (bundle.digest === undefined) return ''
    try {
      const value = bundle.digest(raw, flat)
      return value === null || value === undefined || value === '' ? '' : String(value)
    } catch (error: unknown) {
      this.log.warn(`compute.digest failed for card ${bundle.name}: ${error instanceof Error ? error.message : String(error)}`)
      return ''
    }
  }
}

/** The reference surface identity: `<card>-<sessionId[:8]>-<6 hex>`. */
export function mintSurfaceId(card: string, sessionId: string): string {
  return `${card}-${sessionId.slice(0, 8)}-${randomBytes(3).toString('hex')}`
}

/** One-shot render. */
export async function renderTemplate(root: string, card: string, raw: RawData, options: TemplateRenderOptions = {}, log: A2uiLog = SILENT_LOG): Promise<TemplateRenderResult> {
  return new TemplateEngine(root, log).render(card, raw, options)
}
