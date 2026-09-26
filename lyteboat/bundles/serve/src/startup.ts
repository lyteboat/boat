/**
 * The service app's command-line provider: it parses `--agents`, `--host`,
 * `--port`, `--auth`, and `--secret-env`, checks them, and
 * publishes {@link LYTEBOAT_SERVE_STARTUP_SERVICE}, which the agent catalog,
 * web server, and chat-api rows read from lazy config.
 * @module @lyteboat/serve/startup
 */

import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'lyteboat-serve-startup'

/** Services required before the invocation can be read. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the catalog, web server, and chat-api rows. */
export const LYTEBOAT_SERVE_STARTUP_SERVICE = 'lyteboatServeStartup'

/** What the rows read from {@link LYTEBOAT_SERVE_STARTUP_SERVICE}. */
export interface LyteboatServeStartupValues {
  /** Absolute agent roots; every agent they hold is served. */
  agentRoots: string[]
  /** The listen host: loopback, or every interface. */
  host: '127.0.0.1' | '0.0.0.0'
  /** The listen port; 0 asks the OS for one. */
  port: number
  /** How `/chat` authenticates callers. */
  auth: 'none' | 'shared-secret'
  /** The environment variable that holds the shared secret. */
  credentialRef: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    lyteboatServeStartup: LyteboatServeStartupValues
  }
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

function command(): Command {
  return new Command()
    .name('lyteboat serve')
    .description('Serve the agents of the --agents directories over HTTP: POST /chat, GET /agents, GET /health.')
    .helpOption('-h, --help', 'show this help')
    .option('--agents <dir>', 'a directory of agents to serve (repeatable, at least one)', collect)
    .option('--host <host>', 'listen on 127.0.0.1 (the default) or 0.0.0.0', '127.0.0.1')
    .option('--port <port>', 'listen port; 0 picks a free one', '8080')
    .option('--auth <mode>', 'none (only on 127.0.0.1) or shared-secret (Authorization: Bearer <secret>)', 'none')
    .option('--secret-env <name>', 'the environment variable that holds the shared secret', 'LYTEBOAT_CHAT_SECRET')
    .addHelpText('after', `
Examples:
  lyteboat serve --agents ./agents                              serve on http://127.0.0.1:8080 without auth
  LYTEBOAT_CHAT_SECRET=… lyteboat serve --agents ./agents --host 0.0.0.0 --auth shared-secret
                                                                 serve on every interface behind a bearer token
`)
}

/**
 * Parse and provide the invocation. A missing or unknown agent root, a host
 * other than the two, a bad port, or `--auth none` on every interface is a
 * usage error, so nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = command()
  program.action(() => {
    const options = program.opts<{ agents?: string[]; host: string; port: string; auth: string; secretEnv: string }>()
    const agentRoots = (options.agents ?? []).map(dir => resolve(dir))
    if (agentRoots.length === 0) program.error('error: at least one --agents directory is required')
    for (const dir of agentRoots) {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) program.error(`error: --agents directory not found: ${dir}`)
    }
    if (options.host !== '127.0.0.1' && options.host !== '0.0.0.0') program.error('error: --host must be 127.0.0.1 or 0.0.0.0')
    const port = Number(options.port)
    if (!Number.isInteger(port) || port < 0 || port > 65_535) program.error(`error: --port must be an integer from 0 to 65535, not ${options.port}`)
    if (options.auth !== 'none' && options.auth !== 'shared-secret') program.error('error: --auth must be none or shared-secret')
    if (options.auth === 'none' && options.host !== '127.0.0.1') program.error('error: --auth none serves only 127.0.0.1; use --auth shared-secret with --host 0.0.0.0')
    // program.error() exits, but TypeScript cannot narrow through it.
    const host = options.host === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'
    const auth = options.auth === 'shared-secret' ? 'shared-secret' : 'none'
    ctx.provide(LYTEBOAT_SERVE_STARTUP_SERVICE, {
      agentRoots,
      host,
      port,
      auth,
      credentialRef: options.secretEnv,
    } satisfies LyteboatServeStartupValues)
  })
  parseCmdline(ctx, program)
}
