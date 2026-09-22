import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Workspace imports resolve to src, never through package exports to built lib/, so a
// stale artifact can never load a second copy of a module singleton. The map is the
// tsconfig.base.json `paths` table, turned into exact-match aliases: aliases apply to
// every import site, including the ones vitest rewrites for hoisted `vi.mock` calls,
// where tsconfig-paths resolution does not reach.
const base = JSON.parse(readFileSync(new URL('./tsconfig.base.json', import.meta.url), 'utf8')) as {
  compilerOptions: { paths: Record<string, string[]> }
}
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')
const alias = Object.entries(base.compilerOptions.paths).map(([name, [target]]) => ({
  find: new RegExp(`^${escape(name)}$`, 'u'),
  replacement: fileURLToPath(new URL(target ?? '', import.meta.url)),
}))

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['apps/*/tests/**/*.{spec,e2e}.ts', 'packages/*/tests/**/*.{spec,e2e}.ts', 'scripts/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
