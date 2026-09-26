/**
 * @lyteboat/agent-inspector — what an agent is made of, read from its
 * standing scope (`agentPresets.acquireScope(id)`): the tools its rows and the
 * host register and how each reaches the model (always, once activated, or
 * never), its skills with the tools their lyteboat metadata requires, and how
 * its skills are routed, and each skill's deterministic checks (`findings`).
 * No agent instance is created and nothing is written:
 * a lease on the standing scope is taken per call and released after it. The
 * agent must be one the catalog serves; an unknown id answers undefined.
 * @module @lyteboat/agent-inspector
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@lyteboat/agent-catalog'
import { lyteboatSkillMetaSchema } from '@lyteboat/contracts'
import type { LyteboatInspectedSkill, LyteboatSkillFinding } from '@lyteboat/contracts/cli'
import type { StudioSkillRouting, StudioTool, StudioToolDeclaration } from '@lyteboat/contracts/studio'
import type {} from '@lyteboat/skill-router'
import type {} from '@lyteboat/tool-policy'
import { skillFindingsOf } from './skill-findings.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentInspector: AgentInspectorService
  }
}

/** A skill with the body the model loads. */
export interface AgentInspectorSkillDetail extends LyteboatInspectedSkill {
  content: string
}

/** An agent's skills and how they are routed. */
export interface AgentInspectorSkills {
  skills: LyteboatInspectedSkill[]
  routing: StudioSkillRouting
}

interface SkillLookup {
  scope: ScopeKey
  cwd: string
}

/** Host service: an agent's tools, skills, and routing, from its standing scope. */
export class AgentInspectorService extends Service {
  static inject = ['agentCatalog', 'agentPresets', 'tools', 'skills', 'toolPolicy', 'skillRouter']

  constructor(ctx: Context) {
    super(ctx, 'agentInspector')
  }

  /**
   * The tools an agent can reach, in registry order.
   * @param agentId - an agent the catalog serves.
   * @returns undefined for an unknown agent.
   */
  tools(agentId: string): Promise<StudioTool[] | undefined> {
    return this.inScope(agentId, lookup => this.toolsIn(lookup))
  }

  /**
   * An agent's skills, sorted by name, and its routing settings.
   * @param agentId - an agent the catalog serves.
   * @returns undefined for an unknown agent.
   */
  skills(agentId: string): Promise<AgentInspectorSkills | undefined> {
    return this.inScope(agentId, async lookup => ({ skills: await this.skillsIn(lookup), routing: this.routingIn(lookup) }))
  }

  /**
   * Every skill's deterministic checks, in skill order.
   * @param agentId - an agent the catalog serves.
   * @returns undefined for an unknown agent.
   */
  findings(agentId: string): Promise<{ skill: string; findings: LyteboatSkillFinding[] }[] | undefined> {
    return this.inScope(agentId, async (lookup) => {
      const tools = await this.toolsIn(lookup)
      const routing = this.routingIn(lookup)
      return (await this.skillsIn(lookup)).map(skill => ({ skill: skill.name, findings: skillFindingsOf(skill, tools, routing) }))
    })
  }

  /**
   * One skill with its body, read afresh.
   * @param agentId - an agent the catalog serves.
   * @param name - the skill's name.
   * @returns undefined for an unknown agent or skill.
   */
  skill(agentId: string, name: string): Promise<AgentInspectorSkillDetail | undefined> {
    return this.inScope(agentId, async (lookup) => {
      const definition = await this.ctx.skills.get(name, lookup)
      return definition === undefined ? undefined : { ...inspectedSkill(definition, definition.metadata), content: definition.content }
    })
  }

  /** Run `read` in the agent's standing scope; undefined when the catalog serves no such agent. */
  private async inScope<T>(agentId: string, read: (lookup: SkillLookup) => Promise<T>): Promise<T | undefined> {
    try {
      await this.ctx.agentCatalog.whenReady()
    } catch {
      // Not strict: a failed agent is simply not served; the ones that mounted are.
    }
    const entry = this.ctx.agentCatalog.get(agentId)
    if (entry === undefined) return undefined
    await using lease = await this.ctx.agentPresets.acquireScope(agentId)
    return await read({ scope: lease.key, cwd: entry.workdir })
  }

  private async toolsIn(lookup: SkillLookup): Promise<StudioTool[]> {
    const requiredBy = new Map<string, string[]>()
    for (const skill of await this.skillsIn(lookup)) {
      for (const tool of skill.requiredTools) requiredBy.set(tool, [...requiredBy.get(tool) ?? [], skill.name])
    }
    const visible = new Set(this.ctx.toolPolicy.visible(lookup.scope))
    return this.ctx.tools.schemas(lookup.scope).map((schema): StudioTool => {
      const meta = this.ctx.toolPolicy.metaOf(schema.name, lookup.scope)
      // A declaration without a visibility is `always`, the policy's default.
      const declared: StudioToolDeclaration = meta === undefined ? 'inherited' : meta.visibility ?? 'always'
      return {
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
        declared,
        reach: visible.has(schema.name) ? 'always' : declared === 'auto' ? 'activated' : 'hidden',
        requiredBy: requiredBy.get(schema.name) ?? [],
      }
    })
  }

  private routingIn(lookup: SkillLookup): StudioSkillRouting {
    const settings = this.ctx.skillRouter.settingsFor(lookup.scope)
    return {
      mode: settings.mode,
      ...settings.provider === undefined ? {} : { provider: settings.provider },
      ...settings.model === undefined ? {} : { model: settings.model },
    }
  }

  private async skillsIn(lookup: SkillLookup): Promise<LyteboatInspectedSkill[]> {
    const summaries = await this.ctx.skills.list(lookup)
    const skills = await Promise.all(summaries.map(async summary => inspectedSkill(summary, (await this.ctx.skills.get(summary.name, lookup))?.metadata)))
    return skills.sort((a, b) => a.name.localeCompare(b.name))
  }
}

/** A skill's summary and the tools its lyteboat metadata requires. */
function inspectedSkill(summary: SkillSummary, metadata: Readonly<Record<string, unknown>> | undefined): LyteboatInspectedSkill {
  const parsed = lyteboatSkillMetaSchema.safeParse(metadata?.['lyteboat'] ?? {})
  return {
    name: summary.name,
    description: summary.description,
    ...summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse },
    modelInvocable: summary.invocation.modelInvocable,
    userInvocable: summary.invocation.userInvocable,
    requiredTools: parsed.success ? parsed.data.requiredTools ?? [] : [],
    ...parsed.success ? {} : { metadataProblem: parsed.error.issues.map(issue => `metadata.lyteboat${issue.path.length > 0 ? `.${issue.path.join('.')}` : ''}: ${issue.message}`).join('; ') },
    ...summary.path === undefined ? {} : { file: summary.path },
  }
}

export default AgentInspectorService
