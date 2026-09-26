/**
 * Build the Studio's pages (`lyteboat/plugins/studio-web/src/client`) into
 * `lyteboat/plugins/studio-web/lib/web` with Vite: one HTML page, hashed
 * scripts and styles under `assets/`, served under `/studio/`. React's JSX
 * goes through Vite's own transform (no React plugin); nothing is inlined into
 * the HTML, because the pages' CSP admits only files from their own origin.
 * `pnpm run typecheck` type-checks the pages (tsconfig.client.json); this only bundles them.
 *
 *   node --import tsx scripts/dist/build-studio-web.ts
 * @module scripts/dist/build-studio-web
 */

import { join } from 'node:path'
import { build } from 'vite'
import { repoRoot } from './kernel.ts'

const STUDIO_WEB_DIR = join(repoRoot, 'lyteboat', 'plugins', 'studio-web')

await build({
  configFile: false,
  logLevel: 'warn',
  root: join(STUDIO_WEB_DIR, 'src', 'client'),
  base: '/studio/',
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  build: {
    outDir: join(STUDIO_WEB_DIR, 'lib', 'web'),
    emptyOutDir: true,
    // Every asset stays a file: the CSP refuses inline scripts and styles.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
})
process.stdout.write(`build-studio-web: ${join(STUDIO_WEB_DIR, 'lib', 'web')}\n`)
