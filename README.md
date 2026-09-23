# boat

> **轻舟已过万重山.** A light harness for every industry, built on DeepSeek Harness.

boat is an agent harness built as plugins on top of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) and its Cordis plugin system. The design document tracks the plan; this repository is its implementation, delivered one runnable milestone at a time.

## Vision

AI in production is **Model + Harness**: the model brings general intelligence, the harness turns it into dependable work in one domain, with its tools, skills, state, and rules. boat builds on the DeepSeek Harness community to give every industry such a harness, a light boat that carries vertical teams across the ten thousand mountains between a capable model and a product that ships.

AI 的未来是 Model + Harness。模型提供通用智能，Harness 把它落到具体行业的工具、技能、状态与规则之中。boat 依托 DeepSeek Harness 社区，为各行各业打造 Harness 轻舟，助力垂域轻舟过万重山。

## Status

- M0 — runnable skeleton: `boat run` and `boat web` boot the official dsh bundles through boat's own launcher.
- M1 — `@boat/agentic-loop`, a fork of dsh-agent-loop, the default driver since the layering refactor (`--driver dsh` mounts dsh's official one); both drivers write identical session logs for the same scripted model.
- M2 — boat's own plugins, one runnable step at a time. Step 1: `@boat/contracts` and the boat driver's intake path (`boat/intake`, `boat/pre-assemble`), plus `--plugin <file>`. Step 2: `@boat/run`, boat's one-shot runner, composing the agent from a preset directory (`boat run --agents ./boat/agents --agent <id> "task"`). Step 3: `@boat/tool-policy`, tool visibility (`always`/`auto` + activation), confirmation through the approval seam, and tool-result state deltas folded into the `boatState` projection (`boat/bundles/run/tests/tool-policy.composite.ts`). Step 4: `@boat/skill-router`, ark's skill load modes over the dsh skill registry: `full` puts every skill body in the system prompt, `dynamic` routes each user input through a side model call (ark's router prompt, sticky on null and errors), puts the active skill's body and required tools into the same step, and records `boat/route-request` / `boat/skill-routed`. Step 5: `@boat/a2ui`, ark's A2UI template engine ported field-for-field (manifest resolution, transforms DSL, walker, contract validation, checked against payloads ark produced for the same templates), the `render_a2ui` tool that renders a card from the session state and puts it on the tool result's meta, and the `boatCards` projection (`boat/bundles/run/tests/a2ui.composite.ts`). Step 6: `@boat/history-import`, external conversation history (ark's SA history rules: rounds by trace id, half and malformed rounds dropped, ordered by create time) turned into a session seed of closed turns, so the task becomes the next turn and the first request already derives the imported rounds (`boat run --history <file>`, either driver). Step 7: `boat/agents/demo`, the demo agent preset (persona, two routed skills, an asset tool that fills the state and renders the card in one call, a diagnosis tool, an intake gate), and the M2 integration acceptance over it (`boat run --agents ./boat/agents --agent demo "看看资产"`).

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
pnpm run check                                            # lint + build + tests
```

Every boat profile lists `@boat/host`, which mounts `@boat/agentic-loop` in place of dsh's agent-loop and publishes boat's host services, so `boat run` and `boat web` both carry them; `--driver dsh` swaps the official driver back in. `@boat/host` also keeps dsh-base's session-log upload (`session-log-deepseek`) off, so the model provider receives the request and nothing else. `boat run --agents <dir> --agent <id>` reads the agent directory (`agent.cordis.yml`, optional `preset.yml`) and declares it to dsh's agent preset registry for that run. `--plugin <file>` inserts a local ESM plugin file as a row of the tree (the file's own imports resolve from its directory, so it works for files inside this checkout). Under the boat driver two extra waterfall events run after the inbox claim and before prompt assembly: `boat/intake` (answer the step with a fixed reply and no model request) and `boat/pre-assemble` (route skills and activate tools for this very step).

Model access uses dsh's own settings: `DEEPSEEK_API_KEY` (and optionally `DEEPSEEK_BASE_URL`, an endpoint that speaks DeepSeek's Anthropic-compatible Messages API) in the environment or in `$BOAT_HOME/.env`. All boat data lives under `$BOAT_HOME` (default `~/.boat`); the launcher exports that directory as `DSH_HOME` to the dsh packages before any of them load, so a user's own `~/.dsh` is never touched.

## Session logs

Everything boat records rides an envelope dsh already knows: a card and a state delta sit on `tool/result.meta.boat`, an intake reply is an assistant message whose `source` is `{ provider: 'boat', model: <plugin> }`, and imported history is closed turns of ordinary nodes. Those sessions reopen under dsh's own persistence (`boat/bundles/run/tests/reopen.composite.ts` proves it). The skill router's `boat/skill-routed` and `boat/route-request` have no dsh envelope yet, so a session that routed a skill is refused by dsh's persistence until dsh offers a write path for the envelope's `ignorable` mark; the same test pins that limitation.

## Layout

One top-level directory per layer; dependencies point down only (`apps` → `bundles` → `plugins` → `core`; `agents` → `plugins`, `core`; `tooling` is for tests), and `pnpm run lint` checks it.

| Path | Package | Role |
|---|---|---|
| `boat/apps/cli` | `@boat/cli` | the `boat` launcher: profile templates, patch stack, boot (adapted from dsh's CLI) |
| `boat/bundles/host` | `@boat/host` | the host bundle every boat profile lists: the boat driver in place of dsh's agent-loop, and the tool-policy, skill-router, a2ui, and history-import service rows |
| `boat/bundles/run` | `@boat/run` | the one-shot bundle behind `boat run`: task, `--agent` (alias `--preset`), `--agents`, `--history` |
| `boat/plugins/tool-policy` | `@boat/tool-policy` | tool visibility, confirmation, and state deltas over the dsh tool registry; `./agent` declares policy from an agent's composition file |
| `boat/plugins/skill-router` | `@boat/skill-router` | skill load modes and LLM routing over the dsh skill registry; `./agent` declares the mode from an agent's composition file |
| `boat/plugins/a2ui` | `@boat/a2ui` | the A2UI template engine (ark's template mode), `render_a2ui`, and the `boatCards` projection; `./agent` composes the tool from an agent's composition file |
| `boat/plugins/history-import` | `@boat/history-import` | SA history parsing and the session seed behind `boat run --history` |
| `boat/core/contracts` | `@boat/contracts` | boat's contract extensions over the dsh seams: tool and skill metadata, `boat/*` events, log nodes |
| `boat/core/cordis-compat` | `@boat/cordis-compat` | runtime values for const enums the published cordis build erases |
| `boat/core/agentic-loop` | `@boat/agentic-loop` | the boat agent driver (fork of dsh-agent-loop, see `boat/core/agentic-loop/UPSTREAM.md`) |
| `boat/agents/demo` | `@boat/agent-demo` | the demo agent: `agent.cordis.yml`, `preset.yml` (display name), `skills/`, `a2ui/`, `fixtures/` (personas, a sample SA history), `src/` compiled to `lib/` |
| `boat/tooling/testing` | `@boat/testing` | boat's test harness: dsh service mounting and `MockAdapter`, the session-log reader, the scripted model, launcher spawning |
| `boat/tooling/dsh-agent-loop-testkit-fork` | `@boat/dsh-agent-loop-testkit-fork` | verbatim fork of agent-loop-testkit, used only by the driver's synced upstream tests |
| `scripts/` | — | `sync-upstream.ts` (re-fork from the pinned dsh tag), `check-layers.ts` |
| `dsh.upstream.json` | — | the pinned dsh release; `.pnpmfile.cjs` pins every dsh and cordis package to it |

## Why the pnpm settings look unusual

- `publicHoistPattern: ['@deepseek-ai/*', '@boat/*']` — an agent directory names its rows by bare package name and they resolve from the agent directory upward, and the composition tests resolve rows from the workspace root; under pnpm's isolated layout both reach the dsh and boat packages only at the root `node_modules`. The launcher itself resolves rows through dsh's runtime resolution of `boat/apps/cli`'s dependency graph.
- `minimumReleaseAgeExclude` — pnpm 11 refuses packages younger than a day; a dsh release pinned on its first day is listed there by exact version, and the list can go once the release has aged.
- `.pnpmfile.cjs` — published dsh packages depend on each other with caret ranges, so an unpinned install drifts to a newer prerelease than the tag boat was developed against.
- `allowBuilds` — pnpm 11 blocks install scripts unless listed; only the node-pty helper chmod is needed on Linux/macOS.
