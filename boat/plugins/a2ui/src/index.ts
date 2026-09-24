/**
 * @boat/a2ui — A2UI cards for boat agents. One host service, `ctx.a2ui`,
 * owns the template engine (the reference template mode, ported), the `render_a2ui`
 * tool a composition registers over a templates root, and the `boatCards`
 * projection that collects every rendered card from `tool/result.meta`.
 *
 * The tool reads its raw data from the session's `boatState` projection (the
 * configured state keys, as the reference `state_keys`), renders the chosen card, and
 * returns the digest as the model-facing text; the card itself rides the
 * result's presentation meta (`meta.boat.card`), never the model transcript.
 * @module @boat/a2ui
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { BoatCard, BoatStateValue, JsonValue } from '@boat/contracts'
import type {} from '@boat/tool-policy'
import { TemplateEngine } from './engine.ts'
import type { TemplateRenderOptions, TemplateRenderResult } from './engine.ts'
import { DEFAULT_A2UI_COMPONENT_CATALOG, validateFullPayload } from './contract.ts'
import type { A2uiComponentCatalog } from './contract.ts'
import type { A2uiLog, RawData } from './transforms.ts'

export { TemplateEngine, TemplateModeError, mintSurfaceId, renderTemplate } from './engine.ts'
export type { TemplateRenderOptions, TemplateRenderResult } from './engine.ts'
export { loadBundle } from './loader.ts'
export type { EmissionMode, TemplateBundle } from './loader.ts'
export { resolveManifest } from './resolver.ts'
export { execOne, executeTransforms, resolvePath, TransformError } from './transforms.ts'
export type { A2uiLog, RawData } from './transforms.ts'
export { BoundPathTracker, walk } from './walker.ts'
export type { TemplateDocument } from './walker.ts'
export { DEFAULT_A2UI_COMPONENT_CATALOG, rowTemplateIds, validateDataCoverage, validateEventPayload, validateFullPayload, validatePayload } from './contract.ts'
export type { A2uiComponentCatalog, GuardResult, ValidationResult } from './contract.ts'
export { templateBusinessPayload, BUSINESS_PAYLOAD_KEY } from './business-payload.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    a2ui: A2uiService
  }
}

/** How a `render_a2ui` tool is composed over one templates root. */
export interface RenderToolOptions {
  /** Absolute path of the templates root (one card per directory). */
  templates: string
  /** `boatState` keys collected into the raw namespace: `raw[key] = state[key]` and the key's fields flattened beside it. */
  stateKeys?: string[]
  /** Cards whose successful render concludes the agent's turn (the reference terminal cards). */
  terminalCards?: string[]
  /** Card → one model-facing line for the tool description. */
  cardDescriptions?: Record<string, string>
  /** The tool name; defaults to `render_a2ui`. */
  name?: string
  /** boat tool visibility; defaults to `always`. */
  visibility?: 'always' | 'auto'
  /** boat tool group; defaults to `framework`. */
  group?: string
  /** Contract violations: `warn` keeps the card and records them (the reference default); `enforce` fails the call. */
  validation?: 'warn' | 'enforce'
  /** The client's component catalog the contract is checked against; the reference client by default. */
  components?: A2uiComponentCatalog
}

const jsonValueSchema: zod.ZodType<JsonValue> = zod.lazy(() => zod.union([
  zod.string(), zod.number(), zod.boolean(), zod.null(), zod.array(jsonValueSchema), zod.record(zod.string(), jsonValueSchema),
]))

const boatCardSchema: zod.ZodType<BoatCard> = zod.object({
  callId: zod.string(),
  surfaceId: zod.string(),
  payload: jsonValueSchema,
})

const boatCardsSchema: zod.ZodType<BoatCard[]> = zod.array(boatCardSchema)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The card a tool result's presentation meta carries, when it is one. */
export function cardOfMeta(meta: JsonValue | undefined): { surfaceId: string; payload: JsonValue } | undefined {
  if (!isRecord(meta) || !isRecord(meta['boat']) || !isRecord(meta['boat']['card'])) return undefined
  const card = meta['boat']['card']
  if (typeof card['surfaceId'] !== 'string' || card['payload'] === undefined) return undefined
  return { surfaceId: card['surfaceId'], payload: card['payload'] as JsonValue }
}

function appendCard(state: BoatCard[], card: BoatCard): BoatCard[] {
  const event = isRecord(card.payload) ? card.payload['event'] : undefined
  if (event === 'surfaceUpdate') {
    const index = state.findIndex(existing => existing.surfaceId === card.surfaceId)
    if (index >= 0) return state.map((existing, position) => position === index ? card : existing)
  }
  return [...state, card]
}

export const boatCardsProjectionDefinition = {
  key: 'boatCards',
  stateSchema: boatCardsSchema,
  init: (): BoatCard[] => [],
  apply(state: BoatCard[], event) {
    if (event.type !== 'tool/result') return state
    const card = cardOfMeta(event.data.meta)
    if (card === undefined) return state
    return appendCard(state, { callId: event.data.message.toolCallId, ...card })
  },
  wire: { viewSchema: boatCardsSchema, view: (state: BoatCard[]) => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'boatCards', BoatCard[]>

/** The reference `_collect_raw_data`: each state key namespaced and flattened. */
export function collectRawData(state: BoatStateValue | undefined, stateKeys: readonly string[]): RawData {
  const raw: RawData = {}
  for (const key of stateKeys) {
    let data: unknown = state?.[key]
    if (data === undefined || data === null) continue
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        continue
      }
    }
    if (isRecord(data)) {
      raw[key] = data
      Object.assign(raw, data)
    }
  }
  return raw
}

/** The reference `_parse_object_args`: an object, a JSON object string, or nothing. */
export function parseObjectArgs(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (isRecord(value)) return value
  if (typeof value === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('template_args 必须是 JSON 对象')
    }
    if (isRecord(parsed)) return parsed
  }
  throw new Error('template_args 必须是 JSON 对象')
}

interface RenderToolCatalog {
  cards: string[]
  variants: string[]
  argSpecs: Map<string, Record<string, Record<string, unknown>>>
}

/** Host service: the template engine, the render tool composer and the cards projection. */
export class A2uiService extends Service {
  static inject = ['tools', 'toolPolicy', 'sessionProjections']

  private readonly engines = new Map<string, TemplateEngine>()

  constructor(ctx: Context) {
    super(ctx, 'a2ui')
    ctx.sessionProjections.register(boatCardsProjectionDefinition)
  }

  /** The log the engines degrade into. */
  private get log(): A2uiLog {
    return { warn: message => { this.ctx.logger.warn(`a2ui: ${message}`) } }
  }

  /** The engine for one templates root (shared per root). */
  engine(templates: string): TemplateEngine {
    let engine = this.engines.get(templates)
    if (engine === undefined) {
      engine = new TemplateEngine(templates, this.log)
      this.engines.set(templates, engine)
    }
    return engine
  }

  /**
   * Render one card outside the tool (an orchestration tool composing a card
   * beside its own result).
   */
  render(templates: string, card: string, raw: RawData, options: TemplateRenderOptions = {}): Promise<TemplateRenderResult> {
    return this.engine(templates).render(card, raw, options)
  }

  /** The cards one agent's session has rendered, in log order. */
  cardsOf(agent: Agent): BoatCard[] {
    return this.ctx.sessionProjections.stateOf(agent.session, 'boatCards') ?? []
  }

  /**
   * Register a `render_a2ui` tool over a templates root in the calling
   * scope's layer (through the tool policy, so its state delta and card meta
   * ride the result). Loads every card first so the parameter enums are
   * complete.
   * @returns the exact disposer that unregisters the tool.
   */
  async registerRenderTool(options: RenderToolOptions): Promise<() => void> {
    const engine = this.engine(options.templates)
    const catalog = await this.catalogOf(engine)
    if (catalog.cards.length === 0) throw new Error(`a2ui: no card under templates root ${options.templates}`)
    const stateKeys = options.stateKeys ?? []
    const terminal = new Set(options.terminalCards ?? [])
    const validation = options.validation ?? 'warn'
    const components = options.components ?? DEFAULT_A2UI_COMPONENT_CATALOG
    const log = this.log
    const projections = this.ctx.sessionProjections
    const tool = defineTool({
      name: options.name ?? 'render_a2ui',
      description: describeTool(catalog, options.cardDescriptions ?? {}),
      parameters: {
        template: { type: 'string', required: true, enum: catalog.cards, description: '设计模板卡片类型，server 端解析为前端即用 JSON。' },
        ...catalog.variants.length > 0
          ? { business_hierarchy: { type: 'string', enum: catalog.variants, description: '可选。仅多形态卡片需要：按业务意图选择该卡的内容组合变体；缺省用默认变体。' } }
          : {},
        ...catalog.argSpecs.size > 0
          ? { template_args: { type: 'json', description: `模型抽取的少量入参（落到 args.* 命名空间；大盘工具状态自动注入，无需重复）。按所选 template 填对应字段：\n${argSummary(catalog)}` } }
          : {},
        surface_id: { type: 'string', description: '已有画布 ID。有则原地更新已有画布（surfaceUpdate），无则创建新画布（beginRendering）。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            template: { type: 'string', required: true },
            event: { type: 'string', required: true },
            surfaceId: { type: 'string', required: true },
            digest: { type: 'string', required: true },
            warnings: { type: 'array', required: true, items: { type: 'string' } },
            card: { type: 'json', required: true },
            stateDelta: { type: 'json' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.digest !== '' ? value.digest : `[卡片:${value.template}] 已渲染` }],
        presentationMeta: (_args, value) => ({
          boat: { card: { surfaceId: value.surfaceId, payload: value.card } },
          a2ui: { template: value.template, event: value.event, warnings: value.warnings },
        }),
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error('render_a2ui needs a calling agent: the card data and the rendered cards live on its session')
        const card = args.template
        if (!catalog.cards.includes(card)) throw new Error(`不支持的 template 卡片: ${card}。可选: ${catalog.cards.join(', ')}`)
        const templateArgs = parseObjectArgs(args.template_args)
        const missing = Object.entries(catalog.argSpecs.get(card) ?? {})
          .filter(([name, spec]) => spec['required'] === true && !templateArgs?.[name])
          .map(([name]) => name)
        if (missing.length > 0) log.warn(`template '${card}' 缺少必填 template_args [${missing.map(name => `'${name}'`).join(', ')}]（模型未抽取，卡片可能降级）`)
        const raw = collectRawData(projections.stateOf(agent.session, 'boatState'), stateKeys)
        if (templateArgs !== undefined) raw['args'] = templateArgs
        const result = await engine.render(card, raw, {
          hierarchy: typeof args.business_hierarchy === 'string' && args.business_hierarchy.trim() !== '' ? args.business_hierarchy.trim() : undefined,
          sessionId: agent.session.id,
          surfaceId: typeof args.surface_id === 'string' ? args.surface_id : undefined,
        })
        for (const warning of result.warnings) log.warn(warning)
        const guard = validateFullPayload(result.payload, { strict: validation === 'enforce', log, catalog: components })
        if (validation === 'enforce' && guard.errors.length > 0) throw new Error(`A2UI contract invalid: ${guard.errors[0] ?? ''}`)
        for (const message of [...guard.errors, ...guard.warnings]) log.warn(message)
        if (terminal.has(card)) exec.concludeTurn()
        return {
          template: card,
          event: String(result.payload['event'] ?? 'beginRendering'),
          surfaceId: String(result.payload['surfaceId'] ?? ''),
          digest: result.digest,
          warnings: [...result.warnings, ...guard.errors, ...guard.warnings],
          card: result.payload as JsonValue,
          ...result.stateDelta === undefined ? {} : { stateDelta: result.stateDelta as JsonValue },
        }
      },
    })
    return this.ctx.toolPolicy.register(tool, {
      visibility: options.visibility ?? 'always',
      group: options.group ?? 'framework',
      stateDelta: (_args, value) => (value as { stateDelta?: JsonValue }).stateDelta,
    })
  }

  private async catalogOf(engine: TemplateEngine): Promise<RenderToolCatalog> {
    const cards = engine.cards()
    const variants = new Set<string>()
    const argSpecs = new Map<string, Record<string, Record<string, unknown>>>()
    for (const card of cards) {
      const hierarchies = await engine.hierarchies(card)
      if (hierarchies.length > 1) for (const name of hierarchies) variants.add(name)
      const specs = await engine.argSpecs(card)
      if (Object.keys(specs).length > 0) argSpecs.set(card, specs)
    }
    return { cards, variants: [...variants].sort(), argSpecs }
  }
}

function describeTool(catalog: RenderToolCatalog, descriptions: Record<string, string>): string {
  const lines = catalog.cards.filter(card => descriptions[card] !== undefined).map(card => `- ${card}: ${descriptions[card] ?? ''}`)
  return `生成A2UI卡片内容,供UI渲染。template 模式（设计模板 server 端解析）。${lines.length > 0 ? `\n卡片说明：\n${lines.join('\n')}` : ''}`
}

function argSummary(catalog: RenderToolCatalog): string {
  return [...catalog.argSpecs].map(([card, specs]) => `- ${card}: ${Object.entries(specs).map(([name, spec]) => `${name}${spec['required'] === true ? '(必填)' : '(可选)'}`).join(', ')}`).join('\n')
}

export default A2uiService
