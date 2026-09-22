import { defineConfig } from 'vitest/config'

// Workspace imports resolve to src through tsconfig.base.json paths, never through
// package exports to built lib/, so a stale artifact can never load a second copy.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['apps/*/tests/**/*.{spec,e2e}.ts', 'packages/*/tests/**/*.{spec,e2e}.ts', 'scripts/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
