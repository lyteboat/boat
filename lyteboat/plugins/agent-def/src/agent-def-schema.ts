/**
 * The runtime check of a business agent's declaration. TypeScript checks a
 * `.ts` agent's definition at compile time; this check covers a JavaScript
 * agent and the values types cannot constrain, and it rejects every key the
 * declaration's own shapes do not have, so a misspelt field fails instead of
 * declaring nothing. The persona is dsh-persona's configuration, which that
 * plugin validates when it mounts.
 * @module @lyteboat/agent-def/agent-def-schema
 */

import { z } from 'zod'
import { lyteboatAgentDefIdentitySchema } from '@lyteboat/contracts'

// The hooks are called at mount; a value that is not a function fails there, under its field's name.
const hookSchema = z.custom<unknown>()
const personaSchema = z.custom<unknown>()

const toolPolicySchema = z.strictObject({
  inherited: z.enum(['visible', 'hidden']).exactOptional(),
  tools: z.record(z.string(), z.strictObject({ visibility: z.enum(['always', 'auto']).exactOptional() })).exactOptional(),
})

const skillRoutingSchema = z.strictObject({
  mode: z.enum(['off', 'full', 'dynamic']).exactOptional(),
  historyWindow: z.int().nonnegative().exactOptional(),
  timeoutMs: z.int().nonnegative().exactOptional(),
  maxTokens: z.int().positive().exactOptional(),
  provider: z.string().min(1).exactOptional(),
  model: z.string().min(1).exactOptional(),
})

const modelRequestSchema = z.strictObject({
  temperature: z.number().finite().exactOptional(),
  maxTokens: z.int().positive().exactOptional(),
  stop: z.array(z.string()).exactOptional(),
})

const a2uiRenderToolSchema = z.strictObject({
  templatesDir: z.string().min(1),
  stateKeys: z.array(z.string()).exactOptional(),
  terminalCards: z.array(z.string()).exactOptional(),
  cardDescriptions: z.record(z.string(), z.string()).exactOptional(),
  name: z.string().min(1).exactOptional(),
  visibility: z.enum(['always', 'auto']).exactOptional(),
  validation: z.enum(['warn', 'enforce']).exactOptional(),
  components: z.strictObject({
    types: z.array(z.string()),
    bindingFields: z.record(z.string(), z.array(z.string())),
  }).exactOptional(),
})

const lyteboatAgentDefSchema = z.strictObject({
  ...lyteboatAgentDefIdentitySchema.shape,
  persona: personaSchema.exactOptional(),
  skillDirs: z.array(z.string().min(1)).exactOptional(),
  skillRouting: skillRoutingSchema.exactOptional(),
  toolPolicy: toolPolicySchema.exactOptional(),
  modelRequest: modelRequestSchema.exactOptional(),
  tools: hookSchema.exactOptional(),
  admission: hookSchema.exactOptional(),
  a2uiRenderTool: a2uiRenderToolSchema.exactOptional(),
  eventListeners: hookSchema.exactOptional(),
})

function problemOf(issue: z.core.$ZodIssue): string {
  const at = issue.path.length === 0 ? '' : `${issue.path.join('.')}: `
  if (issue.code === 'unrecognized_keys') return `${at}unknown key${issue.keys.length > 1 ? 's' : ''} ${issue.keys.map(key => JSON.stringify(key)).join(', ')}`
  return `${at}${issue.message}`
}

/**
 * Check a declaration's shape and values.
 * @param agentDef - the declaration as written.
 * @throws naming every problem, each with its path.
 */
export function checkLyteboatAgentDef(agentDef: unknown): void {
  const checked = lyteboatAgentDefSchema.safeParse(agentDef)
  if (!checked.success) throw new Error(`lyteboat agent def: ${checked.error.issues.map(problemOf).join('; ')}`)
}
