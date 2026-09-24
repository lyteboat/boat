/**
 * @boat/history-import — external conversation history as a session seed.
 * dsh derives every model request from the log, so history a caller brings
 * (the reference `context.sa_history`) has to become log nodes: this service parses
 * it with the reference rules and builds the seed of closed turns a new session
 * starts from. Importing into a live session is not offered: the driver
 * counts turns from its own phase, and dsh's persistence would refuse a
 * boat-specific audit node.
 * @module @boat/history-import
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The SA entry list inside a history document: a bare array, or an object
 * carrying it under `sa_history` (or `context.sa_history`, the reference envelope).
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

/** Host service: parse a history document and build the seed. */
export class HistoryImportService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'historyImport')
  }

  /** The reference SA history rules over a raw entry list. */
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
  seed(rounds: readonly HistoryRound[], options: SeedOptions = {}): SeedResult {
    return seedFromRounds(rounds, options)
  }
}

export default HistoryImportService
