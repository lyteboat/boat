import { defineConfig } from 'tsdown'

/**
 * Upstream's root tsdown options for the kernel packages that have no
 * tsdown.config.ts of their own (scripts/dist/bundle-kernel.ts passes it with
 * --config). Upstream's root config also runs its Typert generator plugin; that
 * plugin emits Host-to-Client reflection artifacts, none of which the kernel
 * packages publish, so it is left out here.
 */
export default defineConfig({
  // Entries are relative to the package being bundled, not to this file.
  cwd: process.cwd(),
  entry: ['lib/types/{index,invariant,startup}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
