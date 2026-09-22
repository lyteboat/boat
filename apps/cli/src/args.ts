/**
 * Commander adapter for the `boat` command line.
 *
 * The launcher parses only what it owns — the subcommand, which profile to
 * boot, extra patch overlays, and the config dump — and hands everything after
 * its own flags to the booted tree verbatim, where the app plugins parse their
 * own flag families and print their own `--help` (see `@deepseek-ai/dsh-cmdline`).
 * Launcher flags therefore come first: the first token a subcommand does not
 * recognize starts the inner arguments, so `boat web --port 0` boots the web
 * profile with `--port 0`, and `boat run -h` prints the one-shot app's help.
 *
 * Adapted from deepseek-ai/deepseek-harness apps/cli/src/args.ts
 * @ dsh-v0.1.5-alpha.2 (b2e3b2a0), MIT — see THIRD_PARTY_NOTICES.md.
 * @module @boat/cli/args
 */

import { Command, CommanderError } from 'commander'
import { DEFAULT_DRIVER, DRIVERS, isDriver, type Driver } from './drivers.ts'
import { pluginFilesProblem } from './plugins.ts'
import { DEFAULT_RUN_PROFILE, DEFAULT_WEB_PROFILE } from './templates.ts'

/** Boot a named profile and hand it the invocation's inner arguments. */
export interface ProfileInvocation {
  mode: 'profile'
  profile: string
  /** The agent driver to mount. */
  driver: Driver
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
  /** Local plugin files inserted as rows, in argv order. */
  plugins: string[]
  /** Everything after the launcher's own flags, verbatim, for the app plugins. */
  args: string[]
}

/** Print a composed profile tree and exit without booting. */
export interface DumpConfigInvocation {
  mode: 'dump-config'
  profile: string
  /** The agent driver whose overlay to include. */
  driver: Driver
  /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
  defaultOnly: boolean
  patches: string[]
  plugins: string[]
}

/** The resolved `boat` invocation. Help, version, and errors exit inside {@link parseBoatArgs}. */
export type BoatInvocation = ProfileInvocation | DumpConfigInvocation

/** Versions printed by `boat --version`. */
export interface BoatVersions {
  boat: string
  dsh: string
}

interface BootOptions {
  profile?: string
  patch?: string[]
  driver?: string
  plugin?: string[]
}

/** Repeatable single-value collector; never variadic, which would swallow the inner arguments. */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

const HELP_EXAMPLES = `
Examples:
  boat run "summarize this workspace"         answer one task, print the result, and exit
  boat run --patch ./extra.yml "task"         boot the run profile with one extra overlay
  boat run --driver boat "task"               mount boat's own agent driver instead of dsh's
  boat run --plugin ./my-plugin.mjs "task"    insert a local plugin file into the tree
  boat run -h                                  the one-shot app's own flags and help
  boat web                                     serve the browser UI (boat web --help for its flags)
  boat web --no-open --port 8080               serve without opening a browser, on another port
  boat config dump --profile run               print the composed plugin tree and exit
`

function validateBoot(program: Command, options: BootOptions): { profile: string; patches: string[]; plugins: string[]; driver: Driver } {
  const patches = options.patch ?? []
  if (patches.includes('')) program.error('error: --patch needs a path')
  const plugins = options.plugin ?? []
  if (plugins.includes('')) program.error('error: --plugin needs a path')
  const pluginProblem = pluginFilesProblem(plugins)
  if (pluginProblem !== undefined) program.error(`error: ${pluginProblem}`)
  if (options.profile === '') program.error('error: --profile needs a name')
  const driver = options.driver ?? DEFAULT_DRIVER
  if (!isDriver(driver)) program.error(`error: --driver must be one of ${DRIVERS.join(', ')}, got ${JSON.stringify(driver)}`)
  return { profile: options.profile ?? '', patches, plugins, driver }
}

/** Configure a subcommand that hands its unknown tokens to the booted app. */
function passThrough(command: Command): Command {
  return command
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
}

/**
 * Resolve argv into one invocation, or print and exit for help, version, or an error.
 * @param argv - arguments after the Node binary and script.
 * @param versions - version strings printed by `--version`.
 * @returns the resolved invocation.
 */
export function parseBoatArgs(argv: readonly string[], versions: BoatVersions): BoatInvocation {
  let resolved: BoatInvocation | undefined
  const program: Command = new Command()
  program
    .name('boat')
    .version(`boat ${versions.boat} (dsh ${versions.dsh})`, '-V, --version', 'output the version number')
    .description('boat: an agent harness composed from DeepSeek Harness bundles under your own overrides.')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    .enablePositionalOptions()

  const run = passThrough(program.command('run'))
    .description(`answer one task and exit (profile: ${DEFAULT_RUN_PROFILE})`)
    .argument('[task...]', 'the task text and any flags of the one-shot app')
    .option('--profile <name>', 'the profile under $BOAT_HOME/profiles to boot', DEFAULT_RUN_PROFILE)
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--driver <name>', `the agent driver to mount: ${DRIVERS.join(' | ')}`, DEFAULT_DRIVER)
    .option('--plugin <file>', 'insert a local ESM plugin file as a row of the tree (repeatable)', collect)
    .action((args: string[], options: BootOptions) => {
      const { profile, patches, plugins, driver } = validateBoot(run, options)
      resolved = { mode: 'profile', profile, driver, patches, plugins, args }
    })

  const web = passThrough(program.command('web'))
    .description(`serve the browser UI (profile: ${DEFAULT_WEB_PROFILE}); the web app's own flags follow`)
    .argument('[args...]', 'arguments for the web app (see: boat web --help)')
    .option('--profile <name>', 'the profile under $BOAT_HOME/profiles to boot', DEFAULT_WEB_PROFILE)
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--driver <name>', `the agent driver to mount: ${DRIVERS.join(' | ')}`, DEFAULT_DRIVER)
    .option('--plugin <file>', 'insert a local ESM plugin file as a row of the tree (repeatable)', collect)
    .action((args: string[], options: BootOptions) => {
      const { profile, patches, plugins, driver } = validateBoot(web, options)
      resolved = { mode: 'profile', profile, driver, patches, plugins, args }
    })

  const config = program.command('config').description('inspect profile composition without booting')
  const dump = config.command('dump')
    .description('print the composed profile tree and exit')
    .option('--profile <name>', 'the profile to compose', DEFAULT_RUN_PROFILE)
    .option('--default', 'print the bundle layers only, without the user layer or --patch overlays')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--driver <name>', `the agent driver to mount: ${DRIVERS.join(' | ')}`, DEFAULT_DRIVER)
    .option('--plugin <file>', 'insert a local ESM plugin file as a row of the tree (repeatable)', collect)
    .action((options: BootOptions & { default?: boolean }) => {
      const { profile, patches, plugins, driver } = validateBoot(dump, options)
      const defaultOnly = options.default === true
      if (defaultOnly && (patches.length > 0 || plugins.length > 0)) dump.error('error: --default prints the bundle layers and takes no --patch or --plugin')
      resolved = { mode: 'dump-config', profile, driver, defaultOnly, patches, plugins }
    })

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  if (resolved === undefined) {
    program.outputHelp()
    return process.exit(1)
  }
  return resolved
}
