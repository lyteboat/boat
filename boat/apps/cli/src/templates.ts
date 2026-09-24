/**
 * boat's shipped profile templates. A profile directory under
 * `$BOAT_HOME/profiles/<name>` is initialized from its template on first use;
 * dsh's `loadProfile` only knows dsh's own shipped names, so boat initializes
 * these itself before handing the directory over. Whether the user layers
 * reload live is the composition's call: dsh-base's `hmr` row reloads them,
 * and `@boat/run` disables it for the one-shot run.
 * @module @boat/cli/templates
 */

/** One boat profile template: the ordered bundle layers. */
export interface BoatProfileTemplate {
  bundles: readonly string[]
}

/** Templates by profile name. */
export const BOAT_PROFILE_TEMPLATES: Readonly<Record<string, BoatProfileTemplate>> = {
  run: {
    bundles: ['@deepseek-ai/dsh-base', '@boat/host', '@boat/run'],
  },
  web: {
    bundles: ['@deepseek-ai/dsh-base', '@boat/host', '@deepseek-ai/dsh-web-app'],
  },
}

/** The profile `boat run` boots when `--profile` is absent. */
export const DEFAULT_RUN_PROFILE = 'run'

/** The profile `boat web` boots when `--profile` is absent. */
export const DEFAULT_WEB_PROFILE = 'web'
