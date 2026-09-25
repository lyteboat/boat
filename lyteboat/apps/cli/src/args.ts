/**
 * Commander adapter for the `lyteboat` command line.
 *
 * The launcher parses only what it owns — the subcommand, which profile to
 * boot, extra patch overlays, and the config dump — and hands everything after
 * its own flags to the booted tree verbatim, where the app plugins parse their
 * own flag families and print their own `--help` (see `@deepseek-ai/dsh-cmdline`).
 * Launcher flags therefore come first: the first token a subcommand does not
 * recognize starts the inner arguments, so `lyteboat studio --port 0` boots the
 * studio profile with `--port 0`, and `lyteboat headless -h` prints the one-shot app's help.
 *
 * Adapted from deepseek-ai/deepseek-harness apps/cli/src/args.ts
 * @ dsh-v0.1.7-rc.2 (477b4f42), MIT — see THIRD_PARTY_NOTICES.md.
 * @module @lyteboat/cli/args
 */

import { Command, CommanderError } from 'commander'
import { pluginFilesProblem } from './plugins.ts'
import { DEFAULT_EVAL_PROFILE, DEFAULT_HEADLESS_PROFILE, DEFAULT_SERVE_PROFILE, DEFAULT_STUDIO_PROFILE } from './templates.ts'

/** Boot a named profile and hand it the invocation's inner arguments. */
interface ProfileInvocation {
  mode: 'profile'
  profile: string
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
  /** Local plugin files inserted as rows, in argv order. */
  plugins: string[]
  /** Everything after the launcher's own flags, verbatim, for the app plugins. */
  args: string[]
}

/** Print a composed profile tree and exit without booting. */
interface DumpConfigInvocation {
  mode: 'dump-config'
  profile: string
  /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
  defaultOnly: boolean
  patches: string[]
  plugins: string[]
}

/** The resolved `lyteboat` invocation. Help, version, and errors exit inside {@link parseLyteboatArgs}. */
type LyteboatInvocation = ProfileInvocation | DumpConfigInvocation

/** Versions printed by `lyteboat --version`. */
export interface LyteboatVersions {
  lyteboat: string
  dsh: string
}

interface BootOptions {
  profile?: string
  patch?: string[]
  plugin?: string[]
}

/** Repeatable single-value collector; never variadic, which would swallow the inner arguments. */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

const HELP_EXAMPLES = `
Examples:
  lyteboat headless "summarize this workspace"         answer one task, print the result, and exit
  lyteboat headless --patch ./extra.yml "task"         boot the headless profile with one extra overlay
  lyteboat headless --plugin ./my-plugin.mjs "task"    insert a local plugin file into the tree
  lyteboat headless -h                                 the one-shot app's own flags and help
  lyteboat studio --agents ./agents                    serve dsh web with lyteboat's pages (lyteboat studio --help)
  lyteboat studio --agents ./agents --no-open --port 8080  without opening a browser, on another port
  lyteboat serve --agents ./agents                     serve the agents over HTTP: POST /chat (lyteboat serve --help)
  lyteboat eval --agents ./agents --agent finance      run an agent's eval cases and check every turn (lyteboat eval --help)
  lyteboat config dump --profile headless              print the composed plugin tree and exit
`

function validateBoot(program: Command, options: BootOptions): { profile: string; patches: string[]; plugins: string[] } {
  const patches = options.patch ?? []
  if (patches.includes('')) program.error('error: --patch needs a path')
  const plugins = options.plugin ?? []
  if (plugins.includes('')) program.error('error: --plugin needs a path')
  const pluginProblem = pluginFilesProblem(plugins)
  if (pluginProblem !== undefined) program.error(`error: ${pluginProblem}`)
  if (options.profile === '') program.error('error: --profile needs a name')
  return { profile: options.profile ?? '', patches, plugins }
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
export function parseLyteboatArgs(argv: readonly string[], versions: LyteboatVersions): LyteboatInvocation {
  let resolved: LyteboatInvocation | undefined
  const program: Command = new Command()
  program
    .name('lyteboat')
    .version(`lyteboat ${versions.lyteboat} (dsh ${versions.dsh})`, '-V, --version', 'output the version number')
    .description('lyteboat: an agent harness composed from DeepSeek Harness bundles under your own overrides.')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    .enablePositionalOptions()

  const headless = passThrough(program.command('headless'))
    .description(`answer one task and exit (profile: ${DEFAULT_HEADLESS_PROFILE})`)
    .argument('[task...]', 'the task text and any flags of the one-shot app')
    .option('--profile <name>', 'the profile under $LYTEBOAT_HOME/profiles to boot', DEFAULT_HEADLESS_PROFILE)
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--plugin <file>', 'insert a local ESM plugin file as a row of the tree (repeatable)', collect)
    .action((args: string[], options: BootOptions) => {
      const { profile, patches, plugins } = validateBoot(headless, options)
      resolved = { mode: 'profile', profile, patches, plugins, args }
    })

  const studio = passThrough(program.command('studio'))
    .description(`serve dsh web with lyteboat's pages (profile: ${DEFAULT_STUDIO_PROFILE}); Studio's own flags follow`)
    .argument('[args...]', 'arguments for Studio (see: lyteboat studio --help)')
    .option('--profile <name>', 'the profile under $LYTEBOAT_HOME/profiles to boot', DEFAULT_STUDIO_PROFILE)
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--plugin <file>', 'insert a local ESM plugin file as a row of the tree (repeatable)', collect)
    .action((args: string[], options: BootOptions) => {
      const { profile, patches, plugins } = validateBoot(studio, options)
      resolved = { mode: 'profile', profile, patches, plugins, args }
    })

  const serve = passThrough(program.command('serve'))
    .description(`serve agents over HTTP (profile: ${DEFAULT_SERVE_PROFILE}); the service's own flags follow`)
    .argument('[args...]', 'arguments for the service (see: lyteboat serve --help)')
    .option('--profile <name>', 'the profile under $LYTEBOAT_HOME/profiles to boot', DEFAULT_SERVE_PROFILE)
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--plugin <file>', 'insert a local ESM plugin file as a row of the tree (repeatable)', collect)
    .action((args: string[], options: BootOptions) => {
      const { profile, patches, plugins } = validateBoot(serve, options)
      resolved = { mode: 'profile', profile, patches, plugins, args }
    })

  const evalCommand = passThrough(program.command('eval'))
    .description(`run an agent's eval cases, replay a recorded run, or compare two runs (profile: ${DEFAULT_EVAL_PROFILE}); the eval app's own flags follow`)
    .argument('[args...]', 'arguments for the eval app (see: lyteboat eval --help)')
    .option('--profile <name>', 'the profile under $LYTEBOAT_HOME/profiles to boot', DEFAULT_EVAL_PROFILE)
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--plugin <file>', 'insert a local ESM plugin file as a row of the tree (repeatable)', collect)
    .action((args: string[], options: BootOptions) => {
      const { profile, patches, plugins } = validateBoot(evalCommand, options)
      resolved = { mode: 'profile', profile, patches, plugins, args }
    })

  const config = program.command('config').description('inspect profile composition without booting')
  const dump = config.command('dump')
    .description('print the composed profile tree and exit')
    .option('--profile <name>', 'the profile to compose', DEFAULT_HEADLESS_PROFILE)
    .option('--default', 'print the bundle layers only, without the user layer or --patch overlays')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--plugin <file>', 'insert a local ESM plugin file as a row of the tree (repeatable)', collect)
    .action((options: BootOptions & { default?: boolean }) => {
      const { profile, patches, plugins } = validateBoot(dump, options)
      const defaultOnly = options.default === true
      if (defaultOnly && (patches.length > 0 || plugins.length > 0)) dump.error('error: --default prints the bundle layers and takes no --patch or --plugin')
      resolved = { mode: 'dump-config', profile, defaultOnly, patches, plugins }
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
