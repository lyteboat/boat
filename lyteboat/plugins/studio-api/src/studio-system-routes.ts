/**
 * The System page's endpoints: `system/properties` (the machine, the build,
 * the environment with its secrets masked) and `config/trace-link` (the
 * template a session's trace id fills to open the tracing UI).
 * @module @lyteboat/studio-api/studio-system-routes
 */

import type { StudioTraceLinkAnswer } from '@lyteboat/contracts/studio'
import type { StudioApiRoute } from './studio-api-router.ts'
import { studioSystemAnswer, type StudioSystemFacts } from './studio-system.ts'

/**
 * The routes.
 * @param facts - what the System page shows besides the machine.
 * @param traceLinkTemplate - the configured template, if any.
 */
export function studioSystemRoutes(facts: () => StudioSystemFacts, traceLinkTemplate: string | undefined): StudioApiRoute[] {
  const traceLink: StudioTraceLinkAnswer = traceLinkTemplate === undefined ? {} : { template: traceLinkTemplate }
  return [
    { method: 'GET', path: 'system/properties', access: 'viewer', handle: () => studioSystemAnswer(facts()) },
    { method: 'GET', path: 'config/trace-link', access: 'viewer', handle: () => traceLink },
  ]
}
