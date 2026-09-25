/**
 * Investor education over a small knowledge base of public concepts: a topic
 * matches by its name or an alias contained in the query, the longest match
 * wins, and an unknown topic gets a fallback that says what the base covers.
 * @module @lyteboat/agent-finance/capabilities/investor-knowledge
 */

import { readFileSync } from 'node:fs'
import { z } from 'zod'

const knowledgeEntrySchema = z.object({
  topic: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  text: z.string().min(1),
}).strict()

export type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>

export type KnowledgeLookup =
  | { status: 'ok'; entry: KnowledgeEntry }
  | { status: 'fallback'; topics: string[] }

/**
 * Read and validate the knowledge base.
 * @param path - a JSON array of entries.
 * @throws when the file is missing or malformed.
 */
export function loadKnowledge(path: string): KnowledgeEntry[] {
  const parsed = z.array(knowledgeEntrySchema).min(1).safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) throw new Error(`finance: knowledge base ${path} is malformed: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
  return parsed.data
}

/**
 * Find the entry a query asks about.
 * @param entries - the knowledge base.
 * @param query - the topic as the model extracted it, or the user's words.
 */
export function lookupKnowledge(entries: readonly KnowledgeEntry[], query: string): KnowledgeLookup {
  const normalized = query.trim().toLowerCase()
  let best: { entry: KnowledgeEntry; length: number } | undefined
  for (const entry of entries) {
    for (const name of [entry.topic, ...entry.aliases]) {
      const key = name.toLowerCase()
      if (normalized.includes(key) && (best === undefined || key.length > best.length)) best = { entry, length: key.length }
    }
  }
  return best === undefined ? { status: 'fallback', topics: entries.map(entry => entry.topic) } : { status: 'ok', entry: best.entry }
}
