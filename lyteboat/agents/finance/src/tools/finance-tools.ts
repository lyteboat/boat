/**
 * Register the three finance tools through the tool policy: `auto`, so a tool
 * reaches the model only when the routed skill names it in `requiredTools`.
 * @module @lyteboat/agent-finance/tools/finance-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@lyteboat/tool-policy'
import { defineAllocationDiagnosisTool } from './allocation-diagnosis-tool.ts'
import { defineAssetOverviewTool } from './asset-overview-tool.ts'
import type { FinanceToolDeps } from './finance-tool-support.ts'
import { defineLookupKnowledgeTool } from './lookup-knowledge-tool.ts'

/**
 * Register every finance tool in the calling scope.
 * @param ctx - the agent row's context.
 * @param deps - the finance tool dependencies.
 */
export function registerFinanceTools(ctx: Context, deps: FinanceToolDeps): void {
  for (const definition of [defineAssetOverviewTool(deps), defineAllocationDiagnosisTool(deps), defineLookupKnowledgeTool(deps)]) {
    ctx.toolPolicy.register(definition, { visibility: 'auto' })
  }
}
