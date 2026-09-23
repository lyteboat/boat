import { defineConfig } from 'vitest/config'

// Workspace packages resolve to src through the `@boat/source` export condition, never
// through their default export to built lib/, so a stale artifact can never load a second
// copy of a module singleton. The condition applies to every import site, including the
// ones vitest rewrites for hoisted `vi.mock` calls, and vitest hands it to Node as well.
// Composition tests therefore run in a project without it: the cordis loader imports
// plugin rows natively and must get lib/, which Node can load (src uses TypeScript
// parameter properties, which Node's type stripping rejects).
const conditions = ['@boat/source']
const layers = 'boat/{apps,bundles,plugins,core,agents,tooling}'

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    projects: [
      {
        extends: true,
        resolve: { conditions },
        ssr: { resolve: { conditions } },
        test: {
          name: 'source',
          include: [`${layers}/*/tests/**/*.{spec,e2e}.ts`, 'scripts/**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'composite',
          include: [`${layers}/*/tests/**/*.composite.ts`],
        },
      },
    ],
  },
})
