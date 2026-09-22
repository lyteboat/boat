/**
 * @boat/history-import — external conversation history as a session seed.
 * dsh derives every model request from the log, so history a caller brings
 * (ark's `context.sa_history`) has to become log nodes: this service parses
 * it with ark's rules, builds a seed of closed turns, and folds the trace ids
 * it imported into the `boatImportedTraces` projection so a later import can
 * skip rounds the session already holds.
 * @module @boat/history-import
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { parseSaHistory } from './sa-history.ts'
import type { HistoryRound, SaHistoryParse } from './sa-history.ts'
import { seedFromRounds } from './seed.ts'
import type { SeedOptions, SeedResult } from './seed.ts'

export { parseSaHistory } from './sa-history.ts'
export type { HistoryMessage, HistoryRound, SaHistoryEntry, SaHistoryParse } from './sa-history.ts'
export { HISTORY_IMPORT_MODEL, seedFromRounds } from './seed.ts'
export type { SeedOptions, SeedResult } from './seed.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    historyImport: HistoryImportService
  }
}

const tracesSchema = zod.array(zod.string())

export const boatImportedTracesProjectionDefinition = {
  key: 'boatImportedTraces',
  stateSchema: tracesSchema,
  init: (): string[] => [],
  apply(state: string[], event) {
    if (event.type !== 'boat/history-imported') return state
    const fresh = event.data.traceIds.filter(traceId => !state.includes(traceId))
    return fresh.length === 0 ? state : [...state, ...fresh]
  },
  wire: { viewSchema: tracesSchema, view: (state: string[]) => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'boatImportedTraces', string[]>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The SA entry list inside a history document: a bare array, or an object
 * carrying it under `sa_history` (or `context.sa_history`, ark's envelope).
 */
export function saHistoryOf(document: unknown): unknown {
  if (Array.isArray(document)) return document
  if (isRecord(document)) {
    if (Array.isArray(document['sa_history'])) return document['sa_history']
    const context = document['context']
    if (isRecord(context) && Array.isArray(context['sa_history'])) return context['sa_history']
  }
  return undefined
}

/** Host service: parse, seed, and remember what was imported. */
export class HistoryImportService extends Service {
  static inject = ['sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'historyImport')
    ctx.sessionProjections.register(boatImportedTracesProjectionDefinition)
  }

  /** ark's SA history rules over a raw entry list. */
  parse(raw: unknown): SaHistoryParse {
    return parseSaHistory(raw)
  }

  /**
   * Read a history file (JSON: an SA entry array, or an object with
   * `sa_history` / `context.sa_history`) into rounds; logs what was dropped.
   * @param path - the file path.
   */
  readFile(path: string): { rounds: HistoryRound[]; source: string } {
    const document: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const entries = saHistoryOf(document)
    if (entries === undefined) throw new Error(`history file ${path} holds no sa_history list`)
    const parsed = parseSaHistory(entries)
    const { malformed, duplicated, half, empty } = parsed.dropped
    if (malformed + duplicated + half + empty > 0) {
      this.ctx.logger.warn(`history import: ${basename(path)} dropped ${String(malformed)} malformed, ${String(duplicated)} duplicate-role, ${String(half)} half, ${String(empty)} empty round(s)`)
    }
    return { rounds: parsed.rounds, source: basename(path) }
  }

  /** The seed for a new session: every round as a closed turn. */
  seed(rounds: readonly HistoryRound[], options: SeedOptions): SeedResult {
    return seedFromRounds(rounds, options)
  }

  /** The trace ids one session already imported. */
  importedTraceIds(session: Session): Set<string> {
    return new Set(this.ctx.sessionProjections.stateOf(session, 'boatImportedTraces') ?? [])
  }
}

export default HistoryImportService
