/**
 * The one-shot app's command-line provider: it parses the task positional and
 * the `--preset`, `--agents`, and `--history` flags, then publishes
 * {@link BOAT_RUN_STARTUP_SERVICE}. The roster and runner rows inject that
 * service and read it from lazy config.
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

/** Stable Cordis plugin name. */
export const name = 'boat-run-startup'

/** Services required before the task can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the roster and runner rows. */
export const BOAT_RUN_STARTUP_SERVICE = 'boatRunStartup'

/** What the rows read from {@link BOAT_RUN_STARTUP_SERVICE}. */
export interface BoatRunStartupValues {
  /** The task text this invocation asked for. */
  task: string
  /** The agent preset to compose the agent from; absent runs the host composition alone. */
  preset: string | undefined
  /** Absolute preset root directories; empty without `--agents`. */
  agentRoots: string[]
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
    .option('--preset <id>', 'compose the agent from this preset (needs --agents)')
    .option('--agents <dir>', 'a directory of agent presets (repeatable)', collect)
    .option('--history <file>', 'seed the session from an external history file')
    .addHelpText('after', `
Examples:
  boat run "run the tests"                              answer one task and exit
  boat run --agents ./agents --preset demo "看看资产"   compose the agent from a preset directory
`)
}

/**
 * Parse and provide the one-shot invocation as an ordinary Cordis service. A
 * missing task, an unknown directory, or a preset without roots is a usage
 * error, so on rejection (and on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = command()
  program.action(() => {
    const options = program.opts<{ preset?: string; agents?: string[]; history?: string }>()
    const task = program.args.join(' ')
    if (task.trim() === '') program.error('error: a task is required, for example: boat run "run the tests"')
    const agentRoots = (options.agents ?? []).map(dir => resolve(dir))
    for (const dir of agentRoots) {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) program.error(`error: --agents directory not found: ${dir}`)
    }
    if (options.preset !== undefined && agentRoots.length === 0) program.error('error: --preset needs at least one --agents directory')
    if (agentRoots.length > 0 && options.preset === undefined) program.error('error: --agents needs --preset to choose the agent')
    const history = options.history === undefined ? undefined : resolve(options.history)
    if (history !== undefined && !existsSync(history)) program.error(`error: --history file not found: ${history}`)
    ctx.provide(BOAT_RUN_STARTUP_SERVICE, {
      task, preset: options.preset, agentRoots, history,
    } satisfies BoatRunStartupValues)
  })
  parseCmdline(ctx, program)
}
