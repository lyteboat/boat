/**
 * boat's shipped profile templates. A profile directory under
 * `$BOAT_HOME/profiles/<name>` is initialized from its template on first use;
 * dsh's `loadProfile` only knows dsh's own shipped names, so boat initializes
 * these itself before handing the directory over.
 * @module @boat/cli/templates
 */

import type { ProfilePatchReload } from '@deepseek-ai/dsh-package-manifest'

/** One boat profile template: the ordered bundle layers and the patch-file lifecycle. */
export interface BoatProfileTemplate {
  bundles: readonly string[]
  patchReload: ProfilePatchReload
}

/** Templates by profile name. */
export const BOAT_PROFILE_TEMPLATES: Readonly<Record<string, BoatProfileTemplate>> = {
  run: {
    bundles: ['@deepseek-ai/dsh-base', '@boat/host', '@boat/run'],
    patchReload: 'startup',
  },
  web: {
    bundles: ['@deepseek-ai/dsh-base', '@boat/host', '@deepseek-ai/dsh-web-app'],
    patchReload: 'live',
  },
}

/** The profile `boat run` boots when `--profile` is absent. */
export const DEFAULT_RUN_PROFILE = 'run'

/** The profile `boat web` boots when `--profile` is absent. */
export const DEFAULT_WEB_PROFILE = 'web'
