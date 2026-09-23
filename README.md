# boat

> **轻舟已过万重山.** A light harness for every industry, built on DeepSeek Harness.

boat is an agent harness built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) and its Cordis plugin system, and a distribution of it: boat owns the source of dsh's core packages (the kernel under `dsh/`) under their published names, keeps their protocol, interfaces, and behavior compatible with the release it tracks, and syncs each dsh tag by merge. The design documents track the plan; this repository is its implementation, delivered one runnable milestone at a time.

## Vision

AI in production is **Model + Harness**: the model brings general intelligence, the harness turns it into dependable work in one domain, with its tools, skills, state, and rules. boat builds on the DeepSeek Harness community to give every industry such a harness, a light boat that carries vertical teams across the ten thousand mountains between a capable model and a product that ships.

AI 的未来是 Model + Harness。模型提供通用智能，Harness 把它落到具体行业的工具、技能、状态与规则之中。boat 依托 DeepSeek Harness 社区，为各行各业打造 Harness 轻舟，助力垂域轻舟过万重山。

## Status

- M0 — runnable skeleton: `boat run` and `boat web` boot the official dsh bundles through boat's own launcher.
- M1 — a fork of dsh-agent-loop carrying boat's step hooks, proven log-equivalent to the official driver; retired in D1, when the hooks moved into the kernel's own agent loop.
- M2 — boat's own plugins, one runnable step at a time. Step 1: `@boat/contracts` and the boat driver's intake path (`boat/intake`, `boat/pre-assemble`), plus `--plugin <file>`. Step 2: `@boat/run`, boat's one-shot runner, composing the agent from a preset directory (`boat run --agents ./boat/agents --agent <id> "task"`). Step 3: `@boat/tool-policy`, tool visibility (`always`/`auto` + activation), confirmation through the approval seam, and tool-result state deltas folded into the `boatState` projection (`boat/bundles/run/tests/tool-policy.composite.ts`). Step 4: `@boat/skill-router`, ark's skill load modes over the dsh skill registry: `full` puts every skill body in the system prompt, `dynamic` routes each user input through a side model call (ark's router prompt, sticky on null and errors), puts the active skill's body and required tools into the same step, and records `boat/route-request` / `boat/skill-routed`. Step 5: `@boat/a2ui`, ark's A2UI template engine ported field-for-field (manifest resolution, transforms DSL, walker, contract validation, checked against payloads ark produced for the same templates), the `render_a2ui` tool that renders a card from the session state and puts it on the tool result's meta, and the `boatCards` projection (`boat/bundles/run/tests/a2ui.composite.ts`). Step 6: `@boat/history-import`, external conversation history (ark's SA history rules: rounds by trace id, half and malformed rounds dropped, ordered by create time) turned into a session seed of closed turns, so the task becomes the next turn and the first request already derives the imported rounds (`boat run --history <file>`). Step 7: `boat/agents/demo`, the demo agent preset (persona, two routed skills, an asset tool that fills the state and renders the card in one call, a diagnosis tool, an intake gate), and the M2 integration acceptance over it (`boat run --agents ./boat/agents --agent demo "看看资产"`).
- D0 — distribution tooling (`scripts/dist`): the contract snapshot of the tracked dsh release (`compatibility/contract/`), the per-tag import, the delta report, the overlay gates.
- D1 — the kernel: 11 dsh packages imported under `dsh/` and resolved by name for the whole dependency graph; their builds match the published bundles; G1 (contract) and G2 (upstream's kernel tests, unmodified) run in `pnpm run test`; boat's step hooks are two registered extensions of the kernel's agent loop; `@boat/distro` marks a boat build.
- D2 — compatibility tests against the official release: G4 (same session log for the same scripted run), G5 (23 pinned community plugins installed with `dsh plugin add`), G6 (sessions cross both ways) in `pnpm run compatibility`; G3 and the persistence gate in the sync pipeline.
- Kernel promotion: `llm/llm` (`@deepseek-ai/dsh-llm`) and `skill/skill` (`@deepseek-ai/dsh-skill`) joined the kernel, so the capabilities every composition needs to start (model access, tools, skills, sessions) are boat's own source; 13 packages, under the same gates.
- Tracked release: dsh 0.1.7-rc.1 (`dsh.upstream.json`). The kernel is its import plus boat's two extensions, and every gate above passes against it.

## Docs

Written in Chinese, each one walks a running example end to end against this repository:

| Doc | What it covers |
|---|---|
| [`docs/01-architecture.md`](docs/01-architecture.md) | C4 layers from the system down to the kernel's seams, what happens at startup (sequence diagram), the Lifecycle of every row, how boat and dsh inject and override each other, the flow of one request through the harness, and the order of the session log |
| [`docs/02-distribution.md`](docs/02-distribution.md) | the distribution's conventions and rules: the kernel and the upstream line, a sync step by step, change classes and the extension registry, promotion into the kernel, the gates G1–G6 and how to run them, channels and branches, versions and pins |
| [`docs/03-agent-development.md`](docs/03-agent-development.md) | building a business agent on boat, step by step, with a complete example agent (`policy-desk`): directory, composition file, skills, tools, policy, tests, running it, and what to watch for |

## Requirements

- Node 22.19+ (or 24)
- pnpm 11.7 (`corepack enable` picks the pinned version up from `package.json`)

## Commands

```sh
pnpm install
pnpm run build
node boat/apps/cli/lib/bin.js run "summarize this workspace"   # one-shot task
node boat/apps/cli/lib/bin.js web --no-open                    # browser UI
node boat/apps/cli/lib/bin.js config dump --profile run        # composed plugin tree
node boat/apps/cli/lib/bin.js run --agents ./boat/agents --agent demo "看看资产"
                                                          # the demo agent: routed skill, asset tool, card
pnpm run test                                             # build + G1 + boat's tests + upstream's kernel tests (G2); what CI runs
pnpm run compatibility                                    # G4–G6 against the official release (installs two trees outside the repo)
pnpm run check                                            # lint + test + compatibility
pnpm run dist:delta                                       # what boat carries on top of the imported dsh tag
```

Every boat profile lists `@boat/host`, which publishes boat's host services (`@boat/distro` first), so `boat run` and `boat web` both carry them. dsh-base's own rows stay as they are: their packages resolve to boat's kernel. `@boat/host` also keeps dsh-base's session-log upload (`session-log-deepseek`) off, so the model provider receives the request and nothing else. `boat run --agents <dir> --agent <id>` reads the agent directory (`agent.cordis.yml`, optional `preset.yml`) and declares it to dsh's agent preset registry for that run. `--plugin <file>` inserts a local ESM plugin file as a row of the tree (the file's own imports resolve from its directory, so it works for files inside this checkout). The kernel's agent loop runs two extra waterfall events after the inbox claim and before prompt assembly, registered in `compatibility/contract/extensions.yml`: `boat/intake` (answer the step with a fixed reply and no model request) and `boat/pre-assemble` (route skills and activate tools for this very step). A plugin outside this repository that uses them declares `inject: ['boatDistro']`, so it stays unloaded on the official release.

Model access uses dsh's own settings: `DEEPSEEK_API_KEY` (and optionally `DEEPSEEK_BASE_URL`, an endpoint that speaks DeepSeek's Anthropic-compatible Messages API) in the environment or in `$BOAT_HOME/.env`. All boat data lives under `$BOAT_HOME` (default `~/.boat`); the launcher exports that directory as `DSH_HOME` to the dsh packages before any of them load, so a user's own `~/.dsh` is never touched.

## Session logs

Everything boat records rides an envelope dsh already knows: a card and a state delta sit on `tool/result.meta.boat`, an intake reply is an assistant message whose `source` is `{ provider: 'boat', model: <plugin> }`, and imported history is closed turns of ordinary nodes. Those sessions reopen under dsh's own persistence (`boat/bundles/run/tests/reopen.composite.ts` proves it). The skill router's `boat/skill-routed` and `boat/route-request` have no dsh envelope yet, so a session that routed a skill is refused by dsh's persistence until dsh offers a write path for the envelope's `ignorable` mark; the same test pins that limitation.

## Layout

The repository root separates what boat owns from what it takes over and what it promises:

| Path | What it is |
|---|---|
| `dsh/<group>/<package>` | the kernel: the dsh packages listed in `dsh/kernel.json`, under their published `@deepseek-ai/*` names, imported per tag by `scripts/dist/import-upstream.ts`. Upstream files plus boat's commits, each classified by a `Dist-Change` trailer; boat-owned modules sit in `src/boat/` and `tests/boat/` |
| `boat/<layer>/<package>` | boat's own packages (`@boat/*`), one directory per layer; dependencies point down only (`apps` → `bundles` → `plugins` → `core`; `agents` → `plugins`, `core`; `tooling` is for tests), and `pnpm run lint` checks it |
| `compatibility/` | what boat promises and the proof that it keeps it, no runtime code: `COMPAT.md` (the promise for people), `contract/` (the contract snapshot of each tracked release, `dsh-<version>/`, and `extensions.yml`, the registry of what boat adds), `tests/` (`upstream-harness/` for G2, `scenarios/` G4, `canaries/` G5, `roundtrip/` G6); `compatibility/README.md` lists every gate |
| `docs/` | the guides listed under [Docs](#docs) |
| `scripts/dist/` | the distribution tooling: import, snapshot, contract check (G1), delta report, overlay gates (persistence, G3), kernel bundling, packing and install trees |

| Path | Package | Role |
|---|---|---|
| `boat/apps/cli` | `@boat/cli` | the `boat` launcher: profile templates, patch stack, boot (adapted from dsh's CLI) |
| `boat/bundles/host` | `@boat/host` | the host bundle every boat profile lists: the distro marker, tool-policy, skill-router, a2ui, and history-import service rows |
| `boat/bundles/run` | `@boat/run` | the one-shot bundle behind `boat run`: task, `--agent` (alias `--preset`), `--agents`, `--history` |
| `boat/plugins/distro` | `@boat/distro` | the `boatDistro` service: the dsh release the kernel came from and the kernel extensions this build carries |
| `boat/plugins/tool-policy` | `@boat/tool-policy` | tool visibility, confirmation, and state deltas over the dsh tool registry; `./agent` declares policy from an agent's composition file |
| `boat/plugins/skill-router` | `@boat/skill-router` | skill load modes and LLM routing over the dsh skill registry; `./agent` declares the mode from an agent's composition file |
| `boat/plugins/a2ui` | `@boat/a2ui` | the A2UI template engine (ark's template mode), `render_a2ui`, and the `boatCards` projection; `./agent` composes the tool from an agent's composition file |
| `boat/plugins/history-import` | `@boat/history-import` | SA history parsing and the session seed behind `boat run --history` |
| `boat/core/contracts` | `@boat/contracts` | boat's contract extensions over the dsh seams: tool and skill metadata, the kernel's `boat/*` step events (re-exported), log nodes, `BoatDistro` |
| `boat/core/cordis-compat` | `@boat/cordis-compat` | runtime values for const enums the published cordis build erases |
| `boat/agents/demo` | `@boat/agent-demo` | the demo agent: `agent.cordis.yml`, `preset.yml` (display name), `skills/`, `a2ui/`, `fixtures/` (personas, a sample SA history), `src/` compiled to `lib/` |
| `boat/tooling/testing` | `@boat/testing` | boat's test harness: dsh service mounting and `MockAdapter`, the session-log reader, the scripted model, launcher spawning |
| `scripts/` | — | `check-layers.ts`, `upstream-pins.spec.ts`, and `dist/` |
| `dsh.upstream.json` | — | the tracked dsh release; `.pnpmfile.cjs` pins every non-kernel dsh and cordis package to it |

## Why the pnpm settings look unusual

- After moving or adding a workspace package, reinstall from a clean `node_modules`: an incremental `pnpm install` keeps stale hoisted links.
- `publicHoistPattern: ['@deepseek-ai/*', '@boat/*']` — an agent directory names its rows by bare package name and they resolve from the agent directory upward, and the composition tests resolve rows from the workspace root; under pnpm's isolated layout both reach the dsh and boat packages only at the root `node_modules`. The launcher itself resolves rows through dsh's runtime resolution of `boat/apps/cli`'s dependency graph.
- `minimumReleaseAgeExclude` — pnpm 11 refuses packages younger than a day; a dsh release pinned on its first day is listed there by exact version, and the list can go once the release has aged.
- `overrides` — every kernel package name resolves to its workspace copy under `dsh/`, for boat's packages and for every npm package that depends on it, so the graph holds one instance of each: boat's. `rolldown` is held at the version upstream's lockfile resolves, so the kernel bundles build byte for byte as npm publishes them.
- `.pnpmfile.cjs` — published dsh packages depend on each other with caret ranges, so an unpinned install drifts to a newer prerelease than the tag boat was developed against. It leaves the kernel names alone: it runs after the overrides and would undo them.
- dsh peers — a boat package writes a non-kernel dsh peer as the tracked release's exact version, not `catalog:dsh`: dsh's startup admission reads a row's dsh peers from the manifest on disk, where pnpm never resolves `catalog:`, and disables a row whose peers it cannot match. `scripts/upstream-pins.spec.ts` keeps them equal to `dsh.upstream.json`.
- `allowBuilds` — pnpm 11 blocks install scripts unless listed; only the node-pty helper chmod is needed on Linux/macOS.
