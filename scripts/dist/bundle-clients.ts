/**
 * The browser faces of lyteboat's own packages, bundled the way dsh bundles its
 * client packages (upstream's `packages/client/tsdown.client.ts`). A package has
 * a browser face when its manifest declares `dsh.client`, which is what dsh
 * web's module registry reads; `tsc -b` has compiled its `tsconfig.client.json`
 * to `lib/client-tsc/`, and tsdown bundles `lib/client-tsc/client/index.js` into
 * `lib/client.js`: one CommonJS factory in the module loader's envelope
 * (`window.__ModuleLoader__.load({ id, factory })`), dsh web's platform modules
 * left for the page to supply, everything else bundled in.
 *
 *   node --import tsx scripts/dist/bundle-clients.ts
 * @module scripts/dist/bundle-clients
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'tsdown'
import { carriesClientFace } from './client-face.ts'
import { repoRoot } from './kernel.ts'

/**
 * The modules dsh web's shell shares with every plugin bundle:
 * `PLATFORM_MODULES` of `@deepseek-ai/dsh-client-web` (`src/platform.ts`), whose
 * entry is the shell itself and cannot load in Node; `bundle-clients.spec.ts`
 * holds this copy to the published declaration.
 */
export const DSH_WEB_PLATFORM_MODULES: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
]

/** One lyteboat package with a browser face. */
export interface LyteboatClientPackage {
  /** The package name: the loader keys the factory by it. */
  name: string
  dir: string
}

/** The lyteboat and example packages whose manifests declare `dsh.client`. */
export function lyteboatClientPackages(): LyteboatClientPackage[] {
  const found: LyteboatClientPackage[] = []
  for (const root of ['lyteboat', 'examples']) {
    for (const group of readdirSync(join(repoRoot, root), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      for (const pkg of readdirSync(join(repoRoot, root, group.name), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
        const dir = join(repoRoot, root, group.name, pkg.name)
        const manifestFile = join(dir, 'package.json')
        if (!existsSync(manifestFile)) continue
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { name: string; dsh?: { client?: unknown } }
        if (carriesClientFace(manifest)) found.push({ name: manifest.name, dir })
      }
    }
  }
  return found
}

/**
 * Bundle one package's browser face into `lib/client.js`.
 * @param pkg - the package; its `tsconfig.client.json` output must be built.
 */
export async function bundleClient(pkg: LyteboatClientPackage): Promise<void> {
  const entry = join(pkg.dir, 'lib/client-tsc/client/index.js')
  if (!existsSync(entry)) throw new Error(`${pkg.name}: ${entry} missing; tsc -b compiles the browser face from tsconfig.client.json`)
  const platform = (id: string): boolean => DSH_WEB_PLATFORM_MODULES.includes(id)
  await build({
    config: false,
    cwd: pkg.dir,
    entry: { client: entry },
    outDir: join(pkg.dir, 'lib'),
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    clean: false,
    logLevel: 'warn',
    deps: { neverBundle: platform, alwaysBundle: id => !platform(id) },
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env.MODE': '"production"',
      'import.meta.env': '{"MODE":"production"}',
    },
    outputOptions: {
      entryFileNames: 'client.js',
      chunkFileNames: 'client.[name].js',
      // The loader's envelope, as upstream's client preset writes it.
      banner: chunk => `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  for (const pkg of lyteboatClientPackages()) await bundleClient(pkg)
}
