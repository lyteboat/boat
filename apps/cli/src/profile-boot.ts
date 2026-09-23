/**
 * Shared profile boot for every `boat` surface: initialize the profile from
 * boat's template on first use, resolve it, stack its patch layers (bundle
 * layers in `dsh.profile.bundles` order, the profile's own `cordis.patch.yml`,
 * the home-level layer, `--patch` overlays, the telemetry switch), mount the
 * tree over the profile's empty root config, apply its patch-reload lifecycle,
 * and wire fail-loud plus bounded shutdown.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`.
 *
 * Adapted from deepseek-ai/deepseek-harness apps/cli/src/profile-boot.ts
 * @ dsh-v0.1.5-alpha.2 (b2e3b2a0), MIT — see THIRD_PARTY_NOTICES.md. Changes:
 * boat's own template table replaces dsh's shipped-profile initialization,
 * `--from-default-profile` is dropped, and `FiberState` reads go through
 * `@boat/cordis-compat`.
 * @module @boat/cli/profile-boot
 */

import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  initProfile,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  readProfileManifest,
  resolveProfileDir,
  watchUserPatches,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import { FIBER_STATE } from '@boat/cordis-compat'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'
import { BOAT_PROFILE_TEMPLATES } from './templates.ts'

/** The launcher's diagnostic prefix and the bin name env layers are read for. */
export const NAME = 'boat'

/** Launcher-owned readiness signal committed only after boot and host setup succeed. */
function createAppReady(): { service: AppReady; commit(): void } {
  let ready = false
  const listeners = new Set<() => void>()
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
      if (ready) return
      ready = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
  }
}

/**
 * The home-level user patch layer (`$BOAT_HOME/cordis.patch.yml`), applied over
 * every profile's own layer. Resolved per call: the home is set by the launcher.
 * @returns the absolute patch-file path.
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/** Absolute path of this boat installation's package.json (src/ and lib/ both sit one level under apps/cli). */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# boat profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/**
 * Initialize a profile directory from boat's template when it does not exist
 * yet. An existing directory is never rewritten, so one created by an earlier
 * boat whose bundle list differs from today's template fails loud with the fix
 * instead of booting without the bundles this boat relies on; a user's own
 * changes belong in the profile's `cordis.patch.yml`, not in its bundle list.
 * A name without a boat template is handed to dsh's loader, which knows dsh's
 * own shipped templates and rejects anything else.
 * @param name - the profile name.
 * @param home - the harness home.
 */
export function ensureProfileInitialized(name: string, home: string = resolveDshHome()): void {
  const dir = resolveProfileDir(name, home)
  const template = BOAT_PROFILE_TEMPLATES[name]
  if (!existsSync(join(dir, 'package.json'))) {
    if (template !== undefined) initProfile(dir, template.bundles, template.patchReload)
    return
  }
  if (template === undefined) return
  const bundles = readProfileManifest(NAME, dir).dsh?.profile?.bundles ?? []
  if (bundles.length === template.bundles.length && bundles.every((bundle, index) => bundle === template.bundles[index])) return
  throw new Error(
    `${NAME}: profile "${name}" at ${dir} lists bundles [${bundles.join(', ')}], but this boat's "${name}" template is [${template.bundles.join(', ')}]. `
    + `Set dsh.profile.bundles in ${join(dir, 'package.json')} to the template's list, or move the directory away to have it recreated (keep your cordis.patch.yml).`,
  )
}

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Load a resolved profile for `name` and (re)write the empty root config. The
 * root is always rewritten: the whole composition is patch layers, and the
 * Loader's tree write-back can bake composed rows into this file.
 * @param name - the profile name.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @returns the loaded profile.
 */
export function prepareProfile(name: string, userLayer = true): Profile {
  ensureProfileInitialized(name)
  const profile = loadProfile(NAME, name, INSTALL_ANCHOR, undefined, { userLayer })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers, in application order. */
interface ComposedProfile {
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  bundlePatches: PatchOptions[]
  /** The home-level user layer, applied after the profile's own. */
  homePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: `--patch` overlays and the telemetry switch. */
  overlays: PatchOptions[]
}

/** The full patch stack of one composed profile, in application order. */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return [
    ...composed.bundlePatches,
    ...composed.profile.patches,
    ...composed.homePatches,
    ...composed.overlays,
  ]
}

/**
 * Load `name` and compose its effective patch stack.
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @param launcherOverlays - in-memory layers the launcher derives from its own flags.
 * @returns the profile and its patch layers.
 */
async function composeProfile(
  name: string,
  patchFiles: readonly string[],
  launcherOverlays: readonly PatchOptions[],
): Promise<ComposedProfile> {
  const profile = prepareProfile(name, true)
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile })
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  // Launcher-generated layers (the driver switch) sit above every file overlay so a
  // user file can never displace them.
  const overlays = [...patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file))), ...launcherOverlays]
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlays])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const composedOverlays = [...overlays]
  const telemetryPatch = resolveTelemetryPatch(process.env['DSH_TELEMETRY_DISABLED'], rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) composedOverlays.push(telemetryPatch)
  return { profile, bundlePatches, homePatches, overlays: composedOverlays }
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** The profile name to boot. */
  profile: string
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** In-memory layers derived from launcher flags, applied above every file overlay. */
  launcherOverlays?: readonly PatchOptions[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
}

/**
 * Re-throw a watcher-setup failure unless a shutdown already owns the tree.
 * @param ctx - the booted root context.
 * @param signal - this invocation's signal-shutdown fact.
 * @param error - the setup failure.
 */
function suppressShutdownError(ctx: Context, signal: AbortSignal, error: unknown): void {
  if (signal.aborted) return
  if (ctx.fiber.state !== FIBER_STATE.ACTIVE || ctx.get('loader') === undefined) return
  throw error
}

/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner the composition mounts).
 * @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
 * @returns the settled root context and the shutdown controller.
 */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  // Before the first plugin mounts: Node's fetch ignores the proxy environment on its own.
  const disposeProxy = await installProxyFromEnvironment(
    options.environment,
    (message) => { process.stderr.write(`${NAME}: ${message}\n`) },
  )

  const composed = await composeProfile(options.profile, options.patchFiles, options.launcherOverlays ?? [])
  const app: { current?: Context } = {}
  const appReady = createAppReady()
  const shutdown = createProcessShutdown(async () => {
    await app.current?.fiber.dispose()
    await disposeProxy()
  })
  const signalShutdown = new AbortController()
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    shutdown.interrupt(code)
  }
  // SIGTERM is a supervisor's ordinary stop request and exits 0; SIGINT is a user interrupt and reports 130.
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => {
    await app.current?.fiber.dispose()
  })

  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  // Recomposition for the live user layers: bundle layers below, overlays above.
  // Fresh clones per generation: the include pushes `insert` rows into the mounted
  // tree by reference and later id-targeted patches mutate those objects in place.
  const composeLive = (): PatchOptions[] => structuredClone([
    ...composed.bundlePatches,
    ...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],
    ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
    ...composed.overlays,
  ])
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    provideCmdline(hostCtx, {
      args: options.args,
      exit: code => void shutdown.shutdown(code),
      ready: appReady.service,
    })
  })
  app.current = ctx
  if (composed.profile.patchReload === 'live'
    && !signalShutdown.signal.aborted
    && ctx.fiber.state === FIBER_STATE.ACTIVE
    && ctx.get('loader') !== undefined) {
    try {
      // Config-only HMR for the live profile patch layer: dsh-base disables module
      // reload by default, so mount a watch-only instance with no module roots.
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: composed.profile.patchPath,
        compose: composeLive,
      })
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: homePatchPath(),
        compose: composeLive,
      })
    } catch (error) {
      suppressShutdownError(ctx, signalShutdown.signal, error)
    }
  }
  if (!signalShutdown.signal.aborted
    && ctx.fiber.state === FIBER_STATE.ACTIVE
    && ctx.get('loader') !== undefined) {
    appReady.commit()
  }
  return { ctx, shutdown }
}
