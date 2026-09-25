/**
 * Boot a composition in the test process, the way the `lyteboat` launcher boots a
 * profile: bundle patch layers in order, then extra layers, over an empty root,
 * with the invocation's inner arguments on `ctx.cmdlineArgs`. A bundle's or an
 * agent's composition test runs its real rows (loaded from `lib/`, so build
 * first) without spawning the launcher and without depending on an app.
 *
 * One composition runs at a time per process: it sets `DSH_HOME`, the given
 * environment, and the working directory, captures stdout and stderr, and
 * restores all of them when the run settles. vitest's default `forks` pool
 * gives every test file its own process.
 * @module @lyteboat/testing/composition
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, initProfile, loadLayeredEnv, loadProfile, reportSkippedBundles, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'

/** The diagnostic prefix dsh-app-boot puts on its errors; the launcher's own. */
const BIN_NAME = 'lyteboat'

/** The profile directory name compositions boot from, under their own home. */
const PROFILE = 'composition'

/**
 * The workspace root manifest. Bare row names resolve from here, where every
 * `@deepseek-ai/*` and `@lyteboat/*` package is hoisted; resolving from the profile
 * directory instead finds nothing under vitest, whose entry script lives in the store.
 */
const WORKSPACE_ANCHOR = fileURLToPath(new URL('../../../../package.json', import.meta.url))

/** The launcher disables telemetry export when `DSH_TELEMETRY_DISABLED` is set, as tests do. */
const QUIET: readonly PatchOptions[] = [{ id: 'session-telemetry-otel', disabled: true }]

/** The `run` profile's bundle layers, in the order the launcher's profile template lists them. */
export const LYTEBOAT_RUN_BUNDLES: readonly string[] = ['@deepseek-ai/dsh-base', '@lyteboat/host', '@lyteboat/run']

/** What to boot and how. */
export interface CompositionOptions {
  /** Bundle packages in layer order, e.g. {@link LYTEBOAT_RUN_BUNDLES}. */
  bundles: readonly string[]
  /** Layers above the bundles: row overrides and inserted rows (see {@link pluginFileRow}). */
  patches?: readonly PatchOptions[]
  /** The inner arguments, as they would follow `lyteboat run` on a command line. */
  args: readonly string[]
  /** The working directory the tree sees. */
  cwd: string
  /** Environment set for the run (model endpoint and key); restored afterwards. */
  env: Readonly<Record<string, string>>
  /** The harness home (`DSH_HOME`); a fresh temporary directory when absent. */
  home?: string
  /** Give up after this long without an exit request. */
  timeoutMs?: number
}

/** How one composition run ended. */
export interface CompositionRun {
  /** The code the tree requested through `ctx.appExit`, or 1 when boot failed. */
  code: number
  /** The harness home the run wrote its sessions under. */
  home: string
  stdout: string
  stderr: string
}

export type { PatchOptions }

/**
 * The row the launcher's `--plugin <file>` inserts.
 * @param file - an ESM plugin file.
 * @returns an insert patch naming the file by URL.
 */
export function pluginFileRow(file: string): PatchOptions {
  const absolute = resolve(file)
  return { insert: [{ id: `plugin:${absolute}`, name: pathToFileURL(absolute).href }] }
}

/**
 * The session id a `lyteboat run` composition prints to stderr (`lyteboat: session <id>`).
 * @param stderr - the run's captured stderr.
 * @returns the id.
 * @throws when the run printed no id; the message carries the stderr.
 */
export function printedSessionId(stderr: string): string {
  const id = /^lyteboat: session (\S+)$/mu.exec(stderr)?.[1]
  if (id === undefined) throw new Error(`no "lyteboat: session <id>" line in stderr:\n${stderr}`)
  return id
}

interface Capture {
  stdout: string
  stderr: string
  restore(): void
}

function capture(): Capture {
  const out = process.stdout.write.bind(process.stdout)
  const err = process.stderr.write.bind(process.stderr)
  const state: Capture = {
    stdout: '',
    stderr: '',
    restore: () => {
      process.stdout.write = out
      process.stderr.write = err
    },
  }
  process.stdout.write = ((chunk: string | Uint8Array) => { state.stdout += String(chunk); return true }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => { state.stderr += String(chunk); return true }) as typeof process.stderr.write
  return state
}

function applyEnvironment(env: Readonly<Record<string, string>>): () => void {
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]] as const))
  Object.assign(process.env, env)
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function readiness(): { service: AppReady; commit(): void } {
  const listeners = new Set<() => void>()
  let ready = false
  return {
    service: {
      onReady(listener) {
        if (ready) {
          listener()
          return () => {}
        }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    commit() {
      ready = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
  }
}

function composedPatches(home: string, options: CompositionOptions): { root: string; patches: PatchOptions[] } {
  const dir = resolveProfileDir(PROFILE, home)
  initProfile(dir, options.bundles)
  const profile = loadProfile(BIN_NAME, PROFILE, WORKSPACE_ANCHOR, home)
  reportSkippedBundles(BIN_NAME, profile)
  const root = join(dir, 'cordis.yml')
  writeFileSync(root, '[]\n')
  const patches = [...profile.layers.flatMap(layer => layer.patches), ...QUIET, ...options.patches ?? []]
  return { root, patches: structuredClone(patches) }
}

/**
 * Boot one composition, wait for the tree to request exit, and dispose it.
 * @param options - bundles, extra layers, arguments, working directory, and environment.
 * @returns the exit code, the harness home, and the captured output.
 */
export async function bootComposition(options: CompositionOptions): Promise<CompositionRun> {
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'lyteboat-composition-'))
  const restoreEnv = applyEnvironment({ ...options.env, DSH_HOME: home })
  const cwd = process.cwd()
  process.chdir(options.cwd)
  const output = capture()
  let host: Context | undefined
  let requested: number | undefined
  let settle!: (code: number) => void
  const exited = new Promise<number>(resolveExit => { settle = resolveExit })
  const exit = (code: number): void => {
    requested ??= code
    settle(code)
    void host?.fiber.dispose()
  }
  const timer = setTimeout(() => { output.stderr += `bootComposition: no exit request within ${String(options.timeoutMs ?? 90_000)}ms\n`; exit(1) }, options.timeoutMs ?? 90_000)
  try {
    const { root, patches } = composedPatches(home, options)
    const ready = readiness()
    const booted = boot(BIN_NAME, root, patches, (hostCtx) => {
      host = hostCtx
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, loadLayeredEnv(BIN_NAME, options.cwd))
      provideCmdline(hostCtx, { args: options.args, exit, ready: ready.service })
    }, pathToFileURL(WORKSPACE_ANCHOR).href)
    booted.then(() => { if (requested === undefined) ready.commit() }, (error: unknown) => {
      if (requested !== undefined) return
      output.stderr += `${error instanceof Error ? error.message : String(error)}\n`
      exit(1)
    })
    const code = await exited
    await booted.catch(() => undefined)
    await host?.fiber.dispose()
    return { code, home, stdout: output.stdout, stderr: output.stderr }
  } finally {
    clearTimeout(timer)
    output.restore()
    process.chdir(cwd)
    restoreEnv()
  }
}
