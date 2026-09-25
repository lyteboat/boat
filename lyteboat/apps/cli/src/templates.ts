/**
 * lyteboat's shipped profile templates. A profile directory under
 * `$LYTEBOAT_HOME/profiles/<name>` is initialized from its template on first use;
 * dsh's `loadProfile` only knows dsh's own shipped names, so lyteboat initializes
 * these itself before handing the directory over. Whether the user layers
 * reload live is the composition's call: dsh-base's `hmr` row reloads them,
 * and `@lyteboat/run` disables it for the one-shot run.
 * @module @lyteboat/cli/templates
 */

/** One lyteboat profile template: the ordered bundle layers. */
interface LyteboatProfileTemplate {
  bundles: readonly string[]
}

/** Templates by profile name. */
export const LYTEBOAT_PROFILE_TEMPLATES: Readonly<Record<string, LyteboatProfileTemplate>> = {
  run: {
    bundles: ['@deepseek-ai/dsh-base', '@lyteboat/host', '@lyteboat/run'],
  },
  web: {
    bundles: ['@deepseek-ai/dsh-base', '@lyteboat/host', '@deepseek-ai/dsh-web-app'],
  },
}

/** The profile `lyteboat run` boots when `--profile` is absent. */
export const DEFAULT_RUN_PROFILE = 'run'

/** The profile `lyteboat web` boots when `--profile` is absent. */
export const DEFAULT_WEB_PROFILE = 'web'
