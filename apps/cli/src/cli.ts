/**
 * The boat command dispatcher: parse the launcher's own arguments, then boot a
 * profile or print its composition. Loaded by bin.ts only after the boat home
 * has been exported as `DSH_HOME`.
 * @module @boat/cli/cli
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseBoatArgs, type BoatVersions } from './args.ts'
import { driverOverlay } from './drivers.ts'
import { NAME } from './profile-boot.ts'

/** Read boat's own version and the installed dsh version. */
export function readVersions(): BoatVersions {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  const boat = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  let dsh = 'unknown'
  try {
    const require = createRequire(import.meta.url)
    const upstream = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-app-boot/package.json'), 'utf8')) as { version?: unknown }
    if (typeof upstream.version === 'string') dsh = upstream.version
  } catch {
    // The launcher still runs without the installed dsh version being readable.
  }
  return { boat, dsh }
}

/**
 * Run the boat command line.
 * @returns a promise that settles when the selected command mode finishes.
 */
export async function runCli(): Promise<void> {
  const invocation = parseBoatArgs(process.argv.slice(2), readVersions())
  switch (invocation.mode) {
    case 'profile': {
      const { runProfile } = await import('./profile-boot.ts')
      await runProfile({
        environment: loadLayeredEnv(NAME),
        profile: invocation.profile,
        patchFiles: invocation.patches,
        launcherOverlays: driverOverlay(invocation.driver),
        args: invocation.args,
      })
      break
    }
    case 'dump-config': {
      const { runDumpConfig } = await import('./dump-config.ts')
      runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches, driverOverlay(invocation.driver))
      break
    }
    default:
      invocation satisfies never
      throw new Error(`boat: unhandled invocation ${JSON.stringify(invocation)}`)
  }
}
