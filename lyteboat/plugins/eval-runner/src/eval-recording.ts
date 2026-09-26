/**
 * Facts read back from a recorded session's events: the model each loop
 * request used, from its `request/header` (an effort the adapter defaulted is
 * no choice, as dsh's session controller also reads it). They are read the
 * same way from a session the runner just inspected and from a recording on
 * disk.
 * @module @lyteboat/eval-runner/eval-recording
 */

import { z } from 'zod'
import type { LyteboatAgentModel } from '@lyteboat/contracts'

const requestHeaderEventSchema = z.object({
  type: z.literal('request/header'),
  data: z.object({
    header: z.object({
      config: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }),
      adapterDefaults: z.object({ reasoningEffort: z.boolean().optional() }).optional(),
    }),
  }),
})

/**
 * The distinct models a session's loop requests used, in first-use order.
 * @param events - the session's events, in log order.
 */
export function recordedModelsOf(events: readonly unknown[]): LyteboatAgentModel[] {
  const models = new Map<string, LyteboatAgentModel>()
  for (const event of events) {
    const parsed = requestHeaderEventSchema.safeParse(event)
    if (!parsed.success) continue
    const { config, adapterDefaults } = parsed.data.data.header
    const chosenEffort = config.reasoningEffort !== undefined && adapterDefaults?.reasoningEffort !== true ? config.reasoningEffort : undefined
    const model: LyteboatAgentModel = { provider: config.provider, model: config.model, ...chosenEffort === undefined ? {} : { reasoningEffort: chosenEffort } }
    models.set(JSON.stringify(model), model)
  }
  return [...models.values()]
}
