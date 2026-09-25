/**
 * The one-shot app's command-line provider: it parses the task positional and
 * the `--agent`, `--agents`, `--history`, `--session-id`,
 * and `--context` flags, checks that a root holds the agent, then publishes
 * {@link LYTEBOAT_HEADLESS_STARTUP_SERVICE}. The agent catalog, preset registry, and
 * runner rows inject that service and read it from lazy config.
 *
 * Modeled on deepseek-ai/deepseek-harness packages/bundle/headless/src/startup.ts
 * @ dsh-v0.1.7-rc.2 (477b4f42), MIT — see THIRD_PARTY_NOTICES.md. Differences:
 * the agent, agent-root, history, and context flags, resolved and checked
 * here; no stdin task and no `--json`.
 * @module @lyteboat/headless/startup
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type { JsonValue } from '@lyteboat/contracts'
import { agentIds } from '@lyteboat/agent-catalog'

/** Stable Cordis plugin name. */
export const name = 'lyteboat-headless-startup'

/** Services required before the task can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the agent catalog, preset registry, and runner rows. */
export const LYTEBOAT_HEADLESS_STARTUP_SERVICE = 'lyteboatHeadlessStartup'

/** What the rows read from {@link LYTEBOAT_HEADLESS_STARTUP_SERVICE}. */
export interface LyteboatHeadlessStartupValues {
  /** The task text this invocation asked for. */
  task: string
  /** The agent to compose from (its agent preset id, `--agent`); absent runs the host composition alone. */
  agent: string | undefined
  /** Absolute `--agents` roots the agent catalog declares `agent` from; empty without `--agent`. */
  agentRoots: string[]
  /** Absolute path of an external history file to seed the session from. */
  history: string | undefined
  /** A stored session to continue instead of starting a new one. */
  sessionId: string | undefined
  /** The request context this task carries; absent keeps a continued session's earlier context. */
  context: { [key: string]: JsonValue } | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    lyteboatHeadlessStartup: LyteboatHeadlessStartupValues
  }
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/**
 * The request context a `--context` value names: a JSON object written inline
 * (it starts with `{`) or held in a file.
 * @returns the object, or why it is not one.
 */
function readContext(value: string): { kind: 'context'; context: { [key: string]: JsonValue } } | { kind: 'problem'; problem: string } {
  const inline = value.trimStart().startsWith('{')
  const path = resolve(value)
  if (!inline && !existsSync(path)) return { kind: 'problem', problem: `--context file not found: ${path}` }
  let parsed: unknown
  try {
    parsed = JSON.parse(inline ? value : readFileSync(path, 'utf8'))
  } catch (error: unknown) {
    return { kind: 'problem', problem: `--context is not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'problem', problem: '--context must be a JSON object' }
  // JSON.parse yields JSON: the cast only names it.
  return { kind: 'context', context: parsed as { [key: string]: JsonValue } }
}

function command(): Command {
  return new Command()
    .name('lyteboat headless')
    .description('Answer one task, stream reasoning to stderr, print the final assistant message, and exit.')
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'the task text; multiple words are joined by spaces')
    .option('--agent <id>', 'run this agent from the --agents directories')
    .option('--agents <dir>', 'a directory of agents (repeatable)', collect)
    .option('--history <file>', 'seed the session from an external history file')
    .option('--session-id <id>', 'continue the stored session with this id (every run prints its id to stderr)')
    .option('--context <json>', 'the request context: a JSON object, inline or in a file; logged with the request, read by tools, not shown to the model (an empty one keeps the session\'s)')
    .addHelpText('after', `
Examples:
  lyteboat headless "run the tests"                         answer one task and exit
  lyteboat headless --agents ./agents --agent <id> --context '{"key":"value"}' "<task>"
                                                            run an agent from ./agents with a request context
  lyteboat headless --agents ./agents --agent <id> --session-id session-… "<task>"
                                                            continue that session
`)
}

/**
 * Parse and provide the one-shot invocation as an ordinary Cordis service. A
 * missing task, an unknown directory, an agent without roots, or an agent no
 * root holds is a usage error, so on rejection (and on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = command()
  program.action(() => {
    const options = program.opts<{ agent?: string; agents?: string[]; history?: string; sessionId?: string; context?: string }>()
    const task = program.args.join(' ')
    if (task.trim() === '') program.error('error: a task is required, for example: lyteboat headless "run the tests"')
    const agentRoots = (options.agents ?? []).map(dir => resolve(dir))
    for (const dir of agentRoots) {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) program.error(`error: --agents directory not found: ${dir}`)
    }
    const agent = options.agent
    if (agent !== undefined && agentRoots.length === 0) program.error('error: --agent needs at least one --agents directory')
    if (agentRoots.length > 0 && agent === undefined) program.error('error: --agents needs --agent to choose the agent')
    if (agent !== undefined && !agentIds(agentRoots).includes(agent)) {
      program.error(`error: agent ${JSON.stringify(agent)} not found in the --agents directories (available: ${agentIds(agentRoots).join(', ') || 'none'})`)
    }
    const history = options.history === undefined ? undefined : resolve(options.history)
    if (history !== undefined && !existsSync(history)) program.error(`error: --history file not found: ${history}`)
    const sessionId = options.sessionId
    if (sessionId !== undefined && sessionId.trim() === '') program.error('error: --session-id needs a session id')
    if (sessionId !== undefined && history !== undefined) program.error('error: --history seeds a new session; it cannot be combined with --session-id')
    const read = options.context === undefined ? undefined : readContext(options.context)
    if (read?.kind === 'problem') program.error(`error: ${read.problem}`)
    ctx.provide(LYTEBOAT_HEADLESS_STARTUP_SERVICE, {
      task, agent, agentRoots, history, sessionId, context: read?.kind === 'context' ? read.context : undefined,
    } satisfies LyteboatHeadlessStartupValues)
  })
  parseCmdline(ctx, program)
}
