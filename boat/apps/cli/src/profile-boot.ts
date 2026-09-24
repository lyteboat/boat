/**
 * Shared profile boot for every `boat` surface: initialize the profile from
 * boat's template on first use, resolve it and the installation's runtime
 * package resolution, stack its patch layers (bundle layers in
 * `dsh.profile.bundles` order, the profile's own `cordis.patch.yml`, the
 * home-level layer, `--patch` and launcher overlays, the telemetry switch),
 * mount the tree over the profile's empty root config with the profile's
 * facts provided as `ctx.profileContext`, and wire fail-loud plus bounded
 * shutdown. Live reload of the user layers is dsh-base's `hmr` row, which
 * recomposes from those facts; a bundle that applies patches only at startup
 * disables that row.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`.
 *
 * Adapted from deepseek-ai/deepseek-harness apps/cli/src/profile-boot.ts
 * @ dsh-v0.1.7-rc.1 (46a7f68b), MIT — see THIRD_PARTY_NOTICES.md. Changes:
 * boat's own template table replaces dsh's shipped-profile initialization,
 * `--from-default-profile` and the application-owned profile runtime are
 * dropped, the launcher's own overlays (`--plugin`) sit above the
 * `--patch` overlays, and `FiberState` reads go through `@boat/cordis-compat`.
 * @module @boat/cli/profile-boot
 */

import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot,
  createRuntimeResolution,
  initProfile,
  installFailLoud,
  loadOverlayPatches,
  loadProfile,
  PluginPackages,
  PROFILE_PATCH_FILENAME,
  readProfileManifest,
  readProfilePatches,
  resolveProfileDir,
  type Profile,
  type ProfileContext,
  type RuntimeResolution,
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
    if (template !== undefined) initProfile(dir, template.bundles)
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

/** One profile's boot inputs. */
interface ComposedProfile {
  profile: Profile
  /** The installation's package resolution, computed before any plugin imports. */
  resolution: RuntimeResolution
  /** Layers above the user layers: `--patch` overlays, then the launcher's own. */
  overlays: PatchOptions[]
}

/**
 * Load `name`, resolve the installation's packages for it, and read its overlays.
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @param launcherOverlays - in-memory layers the launcher derives from its own flags.
 * @returns the profile, its package resolution, and its overlays.
 */
async function composeProfile(
  name: string,
  patchFiles: readonly string[],
  launcherOverlays: readonly PatchOptions[],
): Promise<ComposedProfile> {
  const profile = prepareProfile(name, true)
  const resolution = await createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, profile })
  // Launcher-generated layers (`--plugin` rows) sit above every file overlay so a
  // user file can never displace them.
  const overlays = [...patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file))), ...launcherOverlays]
  return { profile, resolution, overlays }
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
  // The facts dsh-base's `hmr` row recomposes the live user layers from:
  // bundle layers below, the profile and home layers, overlays above.
  const profileContext: ProfileContext = {
    name: options.profile,
    dir: composed.profile.dir,
    patchPath: composed.profile.patchPath,
    installAnchor: INSTALL_ANCHOR,
    startedBundles: composed.profile.layers.map(layer => layer.packageName),
    cwd: process.cwd(),
    home: resolveDshHome(),
    overlays: composed.overlays,
    telemetryDisabledEnv: process.env['DSH_TELEMETRY_DISABLED'],
  }
  const ctx = await boot(NAME, rootConfig, readProfilePatches(NAME, profileContext, composed.profile), async (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide('profileContext', profileContext)
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    // Bare row names resolve through the installation's dependency graph.
    await hostCtx.plugin(PluginPackages, { resolution: composed.resolution })
    provideCmdline(hostCtx, {
      args: options.args,
      exit: code => void shutdown.shutdown(code),
      ready: appReady.service,
    })
  })
  app.current = ctx
  if (!signalShutdown.signal.aborted
    && ctx.fiber.state === FIBER_STATE.ACTIVE
    && ctx.get('loader') !== undefined) {
    appReady.commit()
  }
  return { ctx, shutdown }
}
