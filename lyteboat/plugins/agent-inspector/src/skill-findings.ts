/**
 * A skill's deterministic checks against the tools its agent registers and the
 * way it routes skills, as rule ids and the tools each failed on; the Studio's
 * pages and the launcher word them.
 * @module @lyteboat/agent-inspector/skill-findings
 */

import type { LyteboatInspectedSkill, LyteboatSkillFinding } from '@lyteboat/contracts/cli'
import type { StudioSkillRouting, StudioTool } from '@lyteboat/contracts/studio'

/**
 * Check one skill.
 * @param skill - the skill as the inspector reads it.
 * @param tools - the agent's tools.
 * @param routing - the agent's routing settings.
 */
export function skillFindingsOf(skill: LyteboatInspectedSkill, tools: readonly StudioTool[], routing: StudioSkillRouting): LyteboatSkillFinding[] {
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  const unregistered = skill.requiredTools.filter(name => !byName.has(name))
  const undeclared = skill.requiredTools.filter(name => byName.get(name)?.declared === 'inherited')
  const always = skill.requiredTools.filter(name => byName.get(name)?.declared === 'always')
  return [
    { rule: 'metadata-valid', level: 'error', passed: skill.metadataProblem === undefined, tools: [], ...skill.metadataProblem === undefined ? {} : { problem: skill.metadataProblem } },
    { rule: 'required-tools-registered', level: 'error', passed: unregistered.length === 0, tools: unregistered },
    { rule: 'required-tools-declared', level: 'error', passed: undeclared.length === 0, tools: undeclared },
    { rule: 'required-tools-auto', level: 'warn', passed: always.length === 0, tools: always },
    { rule: 'routable', level: 'warn', passed: routing.mode === 'off' || skill.modelInvocable, tools: [] },
  ]
}
