import { defineConfig } from 'vitest/config'

// Workspace packages resolve to src through the `@boat/source` export condition, never
// through their default export to built lib/, so a stale artifact can never load a second
// copy of a module singleton. The condition applies to every import site, including the
// ones vitest rewrites for hoisted `vi.mock` calls. Node and the cordis loader use the
// default conditions and load lib/.
const conditions = ['@boat/source']

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['apps/*/tests/**/*.{spec,e2e}.ts', 'packages/*/tests/**/*.{spec,e2e}.ts', 'packages/bundle/*/tests/**/*.{spec,e2e}.ts', 'agents/*/tests/**/*.spec.ts', 'tooling/*/tests/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
