/**
 * The one-shot app's command-line provider: it parses the task positional and
 * the `--agent` (alias `--preset`), `--agents`, and `--history` flags,
 * resolves the agent to its directory, then publishes
 * {@link BOAT_RUN_STARTUP_SERVICE}. The preset registry and runner rows
 * inject that service and read it from lazy config.
 *
 * Modeled on deepseek-ai/deepseek-harness packages/bundle/headless/src/startup.ts
 * @ dsh-v0.1.5-alpha.2 (b2e3b2a0), MIT — see THIRD_PARTY_NOTICES.md.
 * @module @boat/run/startup
 */

import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { agentIds, findAgentDirectory } from './agent-directory.ts'

/** Stable Cordis plugin name. */
export const name = 'boat-run-startup'

/** Services required before the task can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the preset registry and runner rows. */
export const BOAT_RUN_STARTUP_SERVICE = 'boatRunStartup'

/** What the rows read from {@link BOAT_RUN_STARTUP_SERVICE}. */
export interface BoatRunStartupValues {
  /** The task text this invocation asked for. */
  task: string
  /** The agent to compose from (its agent preset id, `--agent`); absent runs the host composition alone. */
  preset: string | undefined
  /** Absolute directory of that agent: the first `--agents` root holding it; absent without `--agent`. */
  agentDir: string | undefined
  /** Absolute path of an external history file to seed the session from. */
  history: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    boatRunStartup: BoatRunStartupValues
  }
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

function command(): Command {
  return new Command()
    .name('boat run')
    .description('Answer one task, stream reasoning to stderr, print the final assistant message, and exit.')
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'the task text; multiple words are joined by spaces')
    .option('--agent <id>', 'run this agent from the --agents directories')
    .option('--preset <id>', 'deprecated alias of --agent')
    .option('--agents <dir>', 'a directory of agents (repeatable)', collect)
    .option('--history <file>', 'seed the session from an external history file')
    .addHelpText('after', `
Examples:
  boat run "run the tests"                              answer one task and exit
  boat run --agents ./agents --agent demo "看看资产"    run the demo agent from ./agents
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
    const options = program.opts<{ agent?: string; preset?: string; agents?: string[]; history?: string }>()
    const task = program.args.join(' ')
    if (task.trim() === '') program.error('error: a task is required, for example: boat run "run the tests"')
    const agentRoots = (options.agents ?? []).map(dir => resolve(dir))
    for (const dir of agentRoots) {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) program.error(`error: --agents directory not found: ${dir}`)
    }
    if (options.agent !== undefined && options.preset !== undefined) program.error('error: --preset is a deprecated alias of --agent; pass one of them')
    const agent = options.agent ?? options.preset
    if (agent !== undefined && agentRoots.length === 0) program.error('error: --agent needs at least one --agents directory')
    if (agentRoots.length > 0 && agent === undefined) program.error('error: --agents needs --agent to choose the agent')
    const agentDir = agent === undefined ? undefined : findAgentDirectory(agentRoots, agent)
    if (agent !== undefined && agentDir === undefined) {
      program.error(`error: agent ${JSON.stringify(agent)} not found in the --agents directories (available: ${agentIds(agentRoots).join(', ') || 'none'})`)
    }
    const history = options.history === undefined ? undefined : resolve(options.history)
    if (history !== undefined && !existsSync(history)) program.error(`error: --history file not found: ${history}`)
    ctx.provide(BOAT_RUN_STARTUP_SERVICE, {
      task, preset: agent, agentDir, history,
    } satisfies BoatRunStartupValues)
  })
  parseCmdline(ctx, program)
}
