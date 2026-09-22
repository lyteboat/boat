# boat

boat is an agent harness built as plugins on top of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) and its Cordis plugin system. The design document tracks the plan; this repository is its implementation, delivered one runnable milestone at a time.

## Status

M0 — runnable skeleton. `boat run` and `boat web` boot the official dsh bundles through boat's own launcher; no boat plugins yet.

## Requirements

- Node 22.19+ (or 24)
- pnpm 11.7 (`corepack enable` picks the pinned version up from `package.json`)

## Commands

```sh
pnpm install
pnpm run build
node apps/cli/lib/bin.js run "summarize this workspace"   # one-shot task
node apps/cli/lib/bin.js web --no-open                    # browser UI
node apps/cli/lib/bin.js config dump --profile run        # composed plugin tree
pnpm run check                                            # lint + build + tests
```

Model access uses dsh's own settings: `DEEPSEEK_API_KEY` (and optionally `DEEPSEEK_BASE_URL`) in the environment or in `$BOAT_HOME/.env`. All boat data lives under `$BOAT_HOME` (default `~/.boat`); the launcher exports that directory as `DSH_HOME` to the dsh packages before any of them load, so a user's own `~/.dsh` is never touched.

## Layout

| Path | Package | Role |
|---|---|---|
| `apps/cli` | `@boat/cli` | the `boat` launcher: profile templates, patch stack, boot (adapted from dsh's CLI) |
| `packages/cordis-compat` | `@boat/cordis-compat` | runtime values for const enums the published cordis build erases |
| `scripts/session-log.ts` | — | session log reader (multi-frame zstd) shared by tests and tooling |
| `dsh.upstream.json` | — | the pinned dsh release; `.pnpmfile.cjs` pins every dsh and cordis package to it |

## Why the pnpm settings look unusual

- `publicHoistPattern: ['@deepseek-ai/*']` — dsh's launcher links the installation closure into `$DSH_HOME/profiles/node_modules` by walking `require.resolve.paths()` from each package's symlink path; under pnpm's isolated layout that walk only reaches the launcher's direct dependencies.
- `.pnpmfile.cjs` — published dsh packages depend on each other with caret ranges, so an unpinned install drifts to a newer prerelease than the tag boat was developed against.
- `allowBuilds` — pnpm 11 blocks install scripts unless listed; only the node-pty helper chmod is needed on Linux/macOS.
