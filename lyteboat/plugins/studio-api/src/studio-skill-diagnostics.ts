/**
 * A skill's deterministic checks, against the tools its agent registers and
 * the way it routes skills: its lyteboat metadata parses; every tool it
 * requires is registered and declared (the router activates only declared
 * tools, and fails the step otherwise); a required tool is `auto` (an
 * `always` tool is visible anyway); a routed agent can pick it.
 * @module @lyteboat/studio-api/studio-skill-diagnostics
 */

import type { AgentInspectorSkill } from '@lyteboat/agent-inspector'
import type { StudioSkillFinding, StudioSkillRouting, StudioTool } from '@lyteboat/contracts/studio'

function finding(ruleId: string, label: string, level: StudioSkillFinding['level'], failure: string | undefined, passed: string, suggestion?: string): StudioSkillFinding {
  return failure === undefined
    ? { ruleId, label, passed: true, level, message: passed }
    : { ruleId, label, passed: false, level, message: failure, ...suggestion === undefined ? {} : { suggestion } }
}

function listed(names: readonly string[]): string | undefined {
  return names.length === 0 ? undefined : names.join(', ')
}

/**
 * Check one skill.
 * @param skill - the skill as the inspector reads it.
 * @param tools - the agent's tools.
 * @param routing - the agent's routing settings.
 */
export function diagnoseStudioSkill(skill: AgentInspectorSkill, tools: readonly StudioTool[], routing: StudioSkillRouting): StudioSkillFinding[] {
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  const unregistered = skill.requiredTools.filter(name => !byName.has(name))
  const undeclared = skill.requiredTools.filter(name => byName.get(name)?.declared === 'inherited')
  const always = skill.requiredTools.filter(name => byName.get(name)?.declared === 'always')
  const unregisteredList = listed(unregistered)
  const undeclaredList = listed(undeclared)
  const alwaysList = listed(always)
  return [
    finding('metadata-valid', 'lyteboat 元数据', 'error', skill.metadataProblem, 'metadata.lyteboat 可以解析。', 'metadata.lyteboat 只有 requiredTools 一个键，值是工具名的列表。'),
    finding('required-tools-registered', '要求的工具已注册', 'error',
      unregisteredList === undefined ? undefined : `这些工具没有任何行注册：${unregisteredList}；激活技能时这一轮会报错。`,
      `${String(skill.requiredTools.length)} 个要求的工具都已注册。`, '检查工具名的拼写，或在 agent 的代码里注册它。'),
    finding('required-tools-declared', '要求的工具有策略声明', 'error',
      undeclaredList === undefined ? undefined : `这些工具没有在工具策略里声明：${undeclaredList}；路由只激活声明过的工具。`,
      '要求的工具都在工具策略里声明过。', '用 ctx.toolPolicy.register 注册，或在 @lyteboat/tool-policy/agent 行的 tools 里声明。'),
    finding('required-tools-auto', '要求的工具需要激活', 'warn',
      alwaysList === undefined ? undefined : `这些工具本来就一直可见，要求它们不起作用：${alwaysList}。`,
      '要求的工具都是激活后才可见的。', '把它们的 visibility 改成 auto，或从 requiredTools 里去掉。'),
    finding('routable', '可以被路由选中', 'warn',
      routing.mode !== 'off' && !skill.modelInvocable ? '这个技能关掉了模型调用（disable-model-invocation），路由永远不会选它。' : undefined,
      routing.mode === 'off' ? '这个 agent 不加载技能（路由关闭）。' : '模型可以调用这个技能。'),
  ]
}
