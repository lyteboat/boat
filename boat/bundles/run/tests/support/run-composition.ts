import { fileURLToPath } from 'node:url'
import { bootComposition, type CompositionRun, type PatchOptions } from '@boat/testing/composition'

/** The run profile's bundle layers, in the order apps/cli's template lists them. */
export const RUN_BUNDLES = ['@deepseek-ai/dsh-base', '@boat/host', '@boat/run']

/** This package's test fixtures: agent directories, plugin files, history files. */
export const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url))

/** Where a run happens and what it talks to. */
export interface RunTarget {
  cwd: string
  home: string
  env: Record<string, string>
}

/**
 * Boot dsh-base + @boat/host + @boat/run in process with `args` as the one-shot
 * app's arguments, as `boat run <args>` would.
 * @param args - the arguments after `boat run`.
 * @param target - working directory, harness home, and environment.
 * @param patches - layers above the bundles (plugin-file rows).
 * @returns the exit code and captured output.
 */
export function runComposition(args: readonly string[], target: RunTarget, patches: readonly PatchOptions[] = []): Promise<CompositionRun> {
  return bootComposition({ bundles: RUN_BUNDLES, args, cwd: target.cwd, home: target.home, env: target.env, patches })
}
