/**
 * A kernel package's browser face. A dsh package that declares `dsh.client` in
 * its manifest publishes a browser bundle (`lib/client.js`) and the
 * declarations of its `./client` export (`lib/types/client/`), built from
 * `src/client/` with upstream's client preset (`packages/client/tsdown.client.ts`),
 * which imports upstream's own repository scripts and cannot run inside
 * lyteboat. lyteboat builds and changes a kernel package's Node face only: the
 * import carries the published browser files (scripts/dist/import-upstream.ts),
 * and the build accepts them while `src/client/` is the imported source
 * (scripts/dist/bundle-kernel.ts).
 * @module scripts/dist/client-face
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { repoRoot } from './kernel.ts'

/** The manifest field that marks a package with a browser face. */
export interface ClientFaceManifest {
  dsh?: { client?: unknown }
}

/** The export target of a package's browser bundle. */
export const CLIENT_BUNDLE = './lib/client.js'

/** The sibling tsconfig that compiles a package's browser face, by upstream's convention. */
export const CLIENT_TSCONFIG = 'tsconfig.client.json'

/**
 * Whether a package has a browser face that lyteboat carries as published.
 * @param manifest - the package's `package.json`.
 */
export function carriesClientFace(manifest: ClientFaceManifest): boolean {
  return manifest.dsh?.client !== undefined
}

/**
 * The browser-face files under a package directory, as paths relative to it:
 * `lib/client.js` and every file under `lib/types/client/`.
 * @param packageDir - an installed (published) package directory, or a kernel package directory.
 */
export function clientFaceFiles(packageDir: string): string[] {
  const files: string[] = []
  if (existsSync(join(packageDir, 'lib/client.js'))) files.push('lib/client.js')
  const declarations = join(packageDir, 'lib/types/client')
  if (existsSync(declarations)) {
    for (const entry of readdirSync(declarations, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) files.push(relative(packageDir, join(entry.parentPath, entry.name)).split('\\').join('/'))
    }
  }
  return files.sort()
}

/**
 * Whether the kernel package in `dsh/<dir>` carries a browser face.
 * @param dir - the package's directory under `dsh/`.
 */
export function kernelCarriesClientFace(dir: string): boolean {
  return carriesClientFace(JSON.parse(readFileSync(join(repoRoot, 'dsh', dir, 'package.json'), 'utf8')) as ClientFaceManifest)
}
