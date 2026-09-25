/**
 * @lyteboat/history-import — external conversation history as a session seed.
 * dsh derives every model request from the log, so history a caller brings
 * (a list of entries grouped into rounds by trace id) has to become log nodes:
 * this service parses it with the reference round rules and builds the seed of
 * closed turns a new session starts from. Importing into a live session is not offered: the agent
 * loop counts turns from its own phase.
 * @module @lyteboat/history-import
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { historyEntriesOf, parseHistoryRounds } from './round-history.ts'
import type { HistoryRound } from './round-history.ts'
import { seedFromRounds } from './seed.ts'
import type { SeedOptions, SeedResult } from './seed.ts'

export type { SeedResult } from './seed.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    historyImport: HistoryImportService
  }
}

/** Host service: read a history document and build the seed. */
export class HistoryImportService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'historyImport')
  }

  /**
   * Read a history file (JSON: an entry array, or an object with `history` /
   * `context.history`) into rounds; logs what was dropped.
   * @param path - the file path.
   */
  readFile(path: string): { rounds: HistoryRound[]; source: string } {
    const document: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const entries = historyEntriesOf(document)
    if (entries === undefined) throw new Error(`history file ${path} holds no history list`)
    const parsed = parseHistoryRounds(entries)
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
