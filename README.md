# 轻舟 lyteboat

> **轻舟智能体底座 —— 赋能行业穿越 AI 万重山。**
> *Harness for business, built on DeepSeek Harness.*

轻舟是构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）之上的业务智能体底座。我们不做 coding agent，我们要做的是生产级就绪、开箱即用的业务 harness：让 AI 能干活、干得对、有迹可查。

## 愿景

大模型是发动机，不是收割机。发动机再强，不装上专用设备就不收粮食。

今天各行业面临的局面完全一样：模型能力已不是瓶颈，把模型接进真实业务、跑通最后一公里才是。最后一公里里没有新算法，只有一件件具体的事：模型在哪一步该看到哪些工具，哪些操作必须先经人确认，业务状态以谁为准，结果怎样以业务界面交到用户手里，出了问题怎样还原模型当时看到了什么。每个行业团队都要把这些重新做一遍。

轻舟把这最后一公里做成一套可复用的垂域智能体底座。行业团队轻舟出行，加上业务技能、业务工具和卡片模板，就能得到一个上得了生产的智能体。

当前交付进度见下方 [Status](#status)。

## Vision (English)

> **Harness for business, built on DeepSeek Harness.**

The model is the engine, not the harvester: however strong the engine, it brings in no grain until a purpose-built header is mounted on it. Every industry faces the same situation today. Model capability is no longer the bottleneck; wiring the model into real business and closing the last mile is.

lyteboat is not a coding agent. It is a production-ready, out-of-the-box harness for business agents, built as Cordis plugins on DeepSeek Harness (dsh). dsh supplies sessions, tools, skills, approval, persistence, and the web UI; lyteboat adds what business work needs on dsh's seams (skill routing, tool visibility and confirmation, session state, A2UI cards, imported history) and stays domain-neutral; each industry mounts its own header as an agent directory under `lyteboat/agents/`. The goal is AI that gets the work done, does it right, and leaves a trace: everything a model sees is reconstructable from the session log.

lyteboat is also a distribution of dsh: it owns the source of dsh's core packages (the kernel under `dsh/`) under their published names, keeps their protocol, interfaces, and behavior compatible with the release it tracks, and syncs each dsh tag by merge.

The design documents track the plan; this repository is its implementation, delivered one runnable milestone at a time.

## Status

- M0 — runnable skeleton: `lyteboat run` and `lyteboat web` boot the official dsh bundles through lyteboat's own launcher.
- M1 — a fork of dsh-agent-loop carrying lyteboat's step hooks, proven log-equivalent to the official driver; retired in D1, when the hooks moved into the kernel's own agent loop.
- M2 — lyteboat's own plugins, one runnable step at a time. Step 1: `@lyteboat/contracts` and the lyteboat driver's intake path (`lyteboat/intake`, `lyteboat/pre-assemble`), plus `--plugin <file>`. Step 2: `@lyteboat/run`, lyteboat's one-shot runner, composing the agent from a preset directory (`lyteboat run --agents ./lyteboat/agents --agent <id> "task"`). Step 3: `@lyteboat/tool-policy`, tool visibility (`always`/`auto` + activation), confirmation through the approval seam, and tool-result state deltas folded into the `lyteboatState` projection (`lyteboat/bundles/run/tests/tool-policy.composite.ts`). Step 4: `@lyteboat/skill-router`, the reference skill load modes over the dsh skill registry: `full` puts every skill body in the system prompt, `dynamic` routes each user input through a side model call (the reference router prompt, sticky on null and errors), puts the active skill's body and required tools into the same step, and records `lyteboat/route-request` / `lyteboat/skill-routed`. Step 5: `@lyteboat/a2ui`, the reference A2UI template engine ported field-for-field (manifest resolution, transforms DSL, walker, contract validation, checked against payloads the reference implementation produced for the same templates), the `render_a2ui` tool that renders a card from the session state and puts it on the tool result's meta, and the `lyteboatCards` projection (`lyteboat/bundles/run/tests/a2ui.composite.ts`). Step 6: `@lyteboat/history-import`, external conversation history (the reference SA history rules: rounds by trace id, half and malformed rounds dropped, ordered by create time) turned into a session seed of closed turns, so the task becomes the next turn and the first request already derives the imported rounds (`lyteboat run --history <file>`). Step 7: `lyteboat/agents/demo`, the demo agent preset (persona, two routed skills, an asset tool that fills the state and renders the card in one call, a diagnosis tool, an intake gate), and the M2 integration acceptance over it (`lyteboat run --agents ./lyteboat/agents --agent demo "看看资产"`).
- D0 — distribution tooling (`scripts/dist`): the contract snapshot of the tracked dsh release (`compatibility/contract/`), the per-tag import, the delta report, the overlay gates.
- D1 — the kernel: 11 dsh packages imported under `dsh/` and resolved by name for the whole dependency graph; their builds match the published bundles; G1 (contract) and G2 (upstream's kernel tests, unmodified) run in `pnpm run test`; lyteboat's step hooks are two registered extensions of the kernel's agent loop; `@lyteboat/distro` marks a lyteboat build.
- D2 — compatibility tests against the official release: G4 (same session log for the same scripted run), G5 (23 pinned community plugins installed with `dsh plugin add`), G6 (sessions cross both ways) in `pnpm run compatibility`; G3 and the persistence gate in the sync pipeline.
- Kernel promotion: `llm/llm` (`@deepseek-ai/dsh-llm`) and `skill/skill` (`@deepseek-ai/dsh-skill`) joined the kernel, so the capabilities every composition needs to start (model access, tools, skills, sessions) are lyteboat's own source; 13 packages, under the same gates.
- Tracked release: dsh 0.1.7-rc.1 (`dsh.upstream.json`). The kernel is its import plus lyteboat's two extensions, and every gate above passes against it.

## Docs

Written in Chinese, each one walks a running example end to end against this repository:

| Doc | What it covers |
|---|---|
| [`docs/01-architecture.md`](docs/01-architecture.md) | C4 layers from the system down to the kernel's seams, what happens at startup (sequence diagram), the Lifecycle of every row, how lyteboat and dsh inject and override each other, the flow of one request through the harness, and the order of the session log |
| [`docs/02-distribution.md`](docs/02-distribution.md) | the distribution's conventions and rules: the kernel and the upstream line, a sync step by step, change classes and the extension registry, promotion into the kernel, the gates G1–G6 and how to run them, channels and branches, versions and pins |
| [`docs/03-agent-development.md`](docs/03-agent-development.md) | building a business agent on lyteboat, step by step, with a complete example agent (`policy-desk`): directory, composition file, skills, tools, policy, tests, running it, and what to watch for |
| [`docs/04-reference-alignment.md`](docs/04-reference-alignment.md) | analysis: which capabilities of the reference implementation lyteboat should take in, and how to redesign lyteboat's core toward it while keeping dsh's capabilities and practices |

## Requirements

- Node 22.19+ (or 24)
- pnpm 11.7 (`corepack enable` picks the pinned version up from `package.json`)

## Commands

```sh
pnpm install
pnpm run build
node lyteboat/apps/cli/lib/bin.js run "summarize this workspace"   # one-shot task
node lyteboat/apps/cli/lib/bin.js web --no-open                    # browser UI
node lyteboat/apps/cli/lib/bin.js config dump --profile run        # composed plugin tree
node lyteboat/apps/cli/lib/bin.js run --agents ./lyteboat/agents --agent demo "看看资产"
                                                          # the demo agent: routed skill, asset tool, card
pnpm run test                                             # build + G1 + lyteboat's tests + upstream's kernel tests (G2); what CI runs
pnpm run compatibility                                    # G4–G6 against the official release (installs two trees outside the repo)
pnpm run check                                            # lint + test + compatibility
pnpm run dist:delta                                       # what lyteboat carries on top of the imported dsh tag
```

Every lyteboat profile lists `@lyteboat/host`, which publishes lyteboat's host services (`@lyteboat/distro` first), so `lyteboat run` and `lyteboat web` both carry them. dsh-base's own rows stay as they are: their packages resolve to lyteboat's kernel. `@lyteboat/host` also keeps dsh-base's session-log upload (`session-log-deepseek`) off, so the model provider receives the request and nothing else. `lyteboat run --agents <dir> --agent <id>` reads the agent directory (`agent.cordis.yml`, optional `preset.yml`) and declares it to dsh's agent preset registry for that run. `--plugin <file>` inserts a local ESM plugin file as a row of the tree (the file's own imports resolve from its directory, so it works for files inside this checkout). The kernel's agent loop runs two extra waterfall events after the inbox claim and before prompt assembly, registered in `compatibility/contract/extensions.yml`: `lyteboat/intake` (answer the step with a fixed reply and no model request) and `lyteboat/pre-assemble` (route skills and activate tools for this very step). A plugin outside this repository that uses them declares `inject: ['lyteboatDistro']`, so it stays unloaded on the official release.

Model access uses dsh's own settings: `DEEPSEEK_API_KEY` (and optionally `DEEPSEEK_BASE_URL`, an endpoint that speaks DeepSeek's Anthropic-compatible Messages API) in the environment or in `$LYTEBOAT_HOME/.env`. All lyteboat data lives under `$LYTEBOAT_HOME` (default `~/.lyteboat`); the launcher exports that directory as `DSH_HOME` to the dsh packages before any of them load, so a user's own `~/.dsh` is never touched.

## Session logs

Everything lyteboat records rides an envelope dsh already knows: a card and a state delta sit on `tool/result.meta.lyteboat`, an intake reply is an assistant message whose `source` is `{ provider: 'lyteboat', model: <plugin> }`, and imported history is closed turns of ordinary nodes. Those sessions reopen under dsh's own persistence (`lyteboat/bundles/run/tests/reopen.composite.ts` proves it). The skill router's `lyteboat/skill-routed` and `lyteboat/route-request` have no dsh envelope yet, so a session that routed a skill is refused by dsh's persistence until dsh offers a write path for the envelope's `ignorable` mark; the same test pins that limitation.

## Layout

The repository root separates what lyteboat owns from what it takes over and what it promises:

| Path | What it is |
|---|---|
| `dsh/<group>/<package>` | the kernel: the dsh packages listed in `dsh/kernel.json`, under their published `@deepseek-ai/*` names, imported per tag by `scripts/dist/import-upstream.ts`. Upstream files plus lyteboat's commits, each classified by a `Dist-Change` trailer; lyteboat-owned modules sit in `src/lyteboat/` and `tests/lyteboat/` |
| `lyteboat/<layer>/<package>` | lyteboat's own packages (`@lyteboat/*`), one directory per layer; dependencies point down only (`apps` → `bundles` → `plugins` → `core`; `agents` → `plugins`, `core`; `tooling` is for tests), and `pnpm run lint` checks it |
| `compatibility/` | what lyteboat promises and the proof that it keeps it, no runtime code: `COMPAT.md` (the promise for people), `contract/` (the contract snapshot of each tracked release, `dsh-<version>/`, and `extensions.yml`, the registry of what lyteboat adds), `tests/` (`upstream-harness/` for G2, `scenarios/` G4, `canaries/` G5, `roundtrip/` G6); `compatibility/README.md` lists every gate |
| `docs/` | the guides listed under [Docs](#docs) |
| `scripts/dist/` | the distribution tooling: import, snapshot, contract check (G1), delta report, overlay gates (persistence, G3), kernel bundling, packing and install trees |

| Path | Package | Role |
|---|---|---|
| `lyteboat/apps/cli` | `@lyteboat/cli` | the `lyteboat` launcher: profile templates, patch stack, boot (adapted from dsh's CLI) |
| `lyteboat/bundles/host` | `@lyteboat/host` | the host bundle every lyteboat profile lists: the distro marker, tool-policy, skill-router, a2ui, and history-import service rows |
| `lyteboat/bundles/run` | `@lyteboat/run` | the one-shot bundle behind `lyteboat run`: task, `--agent` (alias `--preset`), `--agents`, `--history` |
| `lyteboat/plugins/distro` | `@lyteboat/distro` | the `lyteboatDistro` service: the dsh release the kernel came from and the kernel extensions this build carries |
| `lyteboat/plugins/tool-policy` | `@lyteboat/tool-policy` | tool visibility, confirmation, and state deltas over the dsh tool registry; `./agent` declares policy from an agent's composition file |
| `lyteboat/plugins/skill-router` | `@lyteboat/skill-router` | skill load modes and LLM routing over the dsh skill registry; `./agent` declares the mode from an agent's composition file |
| `lyteboat/plugins/a2ui` | `@lyteboat/a2ui` | the A2UI template engine (the reference template mode), `render_a2ui`, and the `lyteboatCards` projection; `./agent` composes the tool from an agent's composition file |
| `lyteboat/plugins/history-import` | `@lyteboat/history-import` | SA history parsing and the session seed behind `lyteboat run --history` |
| `lyteboat/core/contracts` | `@lyteboat/contracts` | lyteboat's contract extensions over the dsh seams: tool and skill metadata, the kernel's `lyteboat/*` step events (re-exported), log nodes, `LyteboatDistro` |
| `lyteboat/core/cordis-compat` | `@lyteboat/cordis-compat` | runtime values for const enums the published cordis build erases |
| `lyteboat/agents/demo` | `@lyteboat/agent-demo` | the demo agent: `agent.cordis.yml`, `preset.yml` (display name), `skills/`, `a2ui/`, `fixtures/` (personas, a sample SA history), `src/` compiled to `lib/` |
| `lyteboat/tooling/testing` | `@lyteboat/testing` | lyteboat's test harness: dsh service mounting and `MockAdapter`, the session-log reader, the scripted model, launcher spawning |
| `scripts/` | — | `check-layers.ts`, `upstream-pins.spec.ts`, and `dist/` |
| `dsh.upstream.json` | — | the tracked dsh release; `.pnpmfile.cjs` pins every non-kernel dsh and cordis package to it |

## Why the pnpm settings look unusual

- After moving or adding a workspace package, reinstall from a clean `node_modules`: an incremental `pnpm install` keeps stale hoisted links.
- `publicHoistPattern: ['@deepseek-ai/*', '@lyteboat/*']` — an agent directory names its rows by bare package name and they resolve from the agent directory upward, and the composition tests resolve rows from the workspace root; under pnpm's isolated layout both reach the dsh and lyteboat packages only at the root `node_modules`. The launcher itself resolves rows through dsh's runtime resolution of `lyteboat/apps/cli`'s dependency graph.
- `minimumReleaseAgeExclude` — pnpm 11 refuses packages younger than a day; a dsh release pinned on its first day is listed there by exact version, and the list can go once the release has aged.
- `overrides` — every kernel package name resolves to its workspace copy under `dsh/`, for lyteboat's packages and for every npm package that depends on it, so the graph holds one instance of each: lyteboat's. `rolldown` is held at the version upstream's lockfile resolves, so the kernel bundles build byte for byte as npm publishes them.
- `.pnpmfile.cjs` — published dsh packages depend on each other with caret ranges, so an unpinned install drifts to a newer prerelease than the tag lyteboat was developed against. It leaves the kernel names alone: it runs after the overrides and would undo them.
- dsh peers — a lyteboat package writes a non-kernel dsh peer as the tracked release's exact version, not `catalog:dsh`: dsh's startup admission reads a row's dsh peers from the manifest on disk, where pnpm never resolves `catalog:`, and disables a row whose peers it cannot match. `scripts/upstream-pins.spec.ts` keeps them equal to `dsh.upstream.json`.
- `allowBuilds` — pnpm 11 blocks install scripts unless listed; only the node-pty helper chmod is needed on Linux/macOS.
