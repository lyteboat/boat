# lyteboat

[![CI](https://github.com/lyteboat/lyteboat/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/lyteboat/lyteboat/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[中文](README.md) | **English**

> **Harness for business, built on DeepSeek Harness.**

lyteboat (轻舟) is a harness for business agents built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). It is not a coding agent: it is a production-ready, out-of-the-box harness that gets the work done, does it right, and leaves a trace.

- [Why lyteboat](#why-lyteboat)
- [Features](#features)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Documentation](#documentation)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Status and roadmap](#status-and-roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why lyteboat

The model is the engine, not the harvester: however strong the engine, it brings in no grain until a purpose-built header is mounted on it.

Every industry faces the same situation today. Model capability is no longer the bottleneck; wiring the model into real business and closing the last mile is. The last mile holds no new algorithm, only concrete questions: which tools the model sees at which step, which operations need a person's confirmation first, whose business state is authoritative, how a result reaches the user as a business interface, and how to reconstruct what the model saw when something goes wrong. Every industry team answers them again from scratch.

lyteboat turns that last mile into a reusable chassis for vertical agents. A team adds its business skills, tools, and card templates and gets an agent that can go to production.

## Features

- **Business capabilities out of the box**, as Cordis plugins on dsh's seams; the framework packages carry no business vocabulary:
  - Skill routing: `full` puts every skill body in the prompt; `dynamic` picks a skill with a side model call each turn and applies it in the same step; the routed skill is dsh's own skill-invocation message, so the session reopens and continues (`@lyteboat/skill-router`).
  - Tool visibility, confirmation before a call, and state deltas carried by tool results; an agent can hide every inherited tool it does not declare (`@lyteboat/tool-policy`).
  - A2UI template cards: a tool result can carry several, shown at once or placed where the answer writes a `[[card:<area>]]` marker, by emission mode; the `render_a2ui` tool renders them, and so can an agent's own tools (`@lyteboat/a2ui`).
  - Request context: a request enters the log with its own context and admission verdict, and the session keeps the context (`@lyteboat/request-context`).
  - Admission ahead of the loop: an agent registers an admission function that lets a request in or answers it before the loop, cards included (`@lyteboat/intake-guard`); the lower-level `lyteboat/intake` hook is available too.
  - Audited side calls: routing and classification calls leave their full prompt and answer in the session (`@lyteboat/aux-llm`).
  - Import of external conversation history (`@lyteboat/history-import`).
- **One business agent is one directory.** Write its composition file, skills, tools, and card templates under `examples/agents/<id>/`.
- **Compatible with the dsh ecosystem.** lyteboat is a distribution of dsh: it owns the source of dsh's 14 kernel packages under their published names (`dsh/`), so official packages and community plugins run on lyteboat's implementation unchanged. It keeps the protocol, interfaces, and behavior of the dsh release it tracks, and six gates, G1–G6, prove it ([`dsh-compat/`](dsh-compat/README.md)).
- **Traceable.** Everything a model sees is reconstructable from the session log, and every fact lyteboat records rides an envelope dsh already knows.

## Quick start

### Requirements

- Node.js 22.19+ or 24+
- pnpm 11.7 (`corepack enable` picks up the version pinned in `package.json`)

### Install and build

```sh
git clone https://github.com/lyteboat/lyteboat.git
cd lyteboat
corepack enable
pnpm install
pnpm run build
```

The launcher is `lyteboat/apps/cli/lib/bin.js`; the examples below call it `lyteboat`:

```sh
alias lyteboat="node $PWD/lyteboat/apps/cli/lib/bin.js"
```

### Configure the model

lyteboat uses dsh's model settings: set `DEEPSEEK_API_KEY` in the environment or in `$LYTEBOAT_HOME/.env`. `DEEPSEEK_BASE_URL` is optional and points to an endpoint that speaks DeepSeek's Anthropic-compatible Messages API.

Side calls (skill routing, intake classification) use their route's default reasoning effort; DeepSeek thinks before it answers by default, and the thinking counts against the call's `maxTokens`. To have side calls answer directly, give the `lyteboat-aux-llm` row an effort in a patch file and add it with `--patch`:

```yaml
- id: lyteboat-aux-llm
  config:
    reasoningEffort: 'off'    # the route's model adapter defines the ids; this one is DeepSeek's
```

### Run

```sh
lyteboat run "summarize this workspace"                       # one-shot task: answer and exit
lyteboat run --agents ./examples/agents --agent finance --context '{"customer":"young-idle-cash"}' "看看我的资产"   # the finance agent: the request context names the customer
lyteboat web --no-open                                        # browser UI
```

## Usage

### Commands

| Command | What it does |
|---|---|
| `lyteboat run [options] "task"` | Answers one task, prints the result, and exits (profile `run`) |
| `lyteboat web [options]` | Serves the browser UI (profile `web`); `lyteboat web --help` lists its own flags |
| `lyteboat config dump [options]` | Prints the composed plugin tree and exits; `--default` shows the bundle layers only |

All three accept:

| Option | What it does |
|---|---|
| `--profile <name>` | The profile under `$LYTEBOAT_HOME/profiles` to boot |
| `--patch <path>` | An extra patch layer applied after the profile layer (repeatable) |
| `--plugin <file>` | Inserts a local ESM plugin file as a row of the tree (repeatable) |

`lyteboat run` also takes:

| Option | What it does |
|---|---|
| `--agents <dir>` | A directory of agents (repeatable) |
| `--agent <id>` | Runs one agent from those directories |
| `--history <file>` | Imports external conversation history first; the task becomes its next turn |
| `--session-id <id>` | Continues a stored session; every run prints its session id to stderr |
| `--context <json>` | The request context: a JSON object, inline or in a file; logged with the request, read by tools, not shown to the model |

`lyteboat run -h` lists every flag of the one-shot mode.

### Writing a business agent

A business agent is a directory `examples/agents/<id>/`, named by its id. Business agents are not part of the distribution: they build on `lyteboat/`, and nothing in `lyteboat/` depends on them.

- `agent.cordis.yml` (required): the plugin rows for persona, skill routing, tools, and policy; each row applies to this agent's sessions only.
- `preset.yml`: display information such as the name.
- `assets/`: the non-code files read at runtime, beside `src/` and `lib/`: `skills/` (one `SKILL.md` per skill), `a2ui/` (card templates), `sample-data/`.
- `src/`: business code, compiled to `lib/` and loaded by `./lib/x.js` rows of the composition file.

The [agent development guide](docs/03-agent-development.md) walks through every step with a runnable example; [`examples/agents/finance`](examples/agents/finance) is a working agent kept deliberately minimal, there to exercise the end-to-end flow.

### Data and session logs

- All lyteboat data lives under `$LYTEBOAT_HOME` (default `~/.lyteboat`). The launcher exports that directory as `DSH_HOME` before any dsh package loads, so your own `~/.dsh` is never touched.
- The session log is the single source of truth. A card and a state delta sit on `tool/result.meta.lyteboat`, a request's context and admission verdict on the human message's `source.lyteboatRequest`, a routed skill is dsh's own skill-invocation message, an intake reply is an assistant message whose `source.provider` is `lyteboat`, and imported history is closed turns of ordinary nodes; the side-call audit `lyteboat/aux-llm-call` is marked ignorable. So these sessions reopen under dsh's own persistence.
- `@lyteboat/host` turns off dsh-base's `session-log-deepseek` row: the model provider receives the request and nothing else.

## Documentation

The guides are written in Chinese.

| Document | What it covers |
|---|---|
| [Architecture](docs/01-architecture.md) | lyteboat's architecture: C4 layers, the startup sequence, lifecycle and dependency injection, the flow of one request, the session log |
| [Distribution](docs/02-distribution.md) | The distribution machinery: the kernel and the upstream line, a sync step by step, change classes, promotion, how to run each gate, branches and channels, versions and pins |
| [Agent development](docs/03-agent-development.md) | The agent-development guide: building a business agent from scratch, its directory, composition, skills, tools, policy, cards, admission, tests, and running it |
| [Alignment with the reference implementation](docs/04-reference-alignment.md) | The reference-alignment analysis and forward plan: which capabilities of the reference implementation to bring in, and how they land on lyteboat while keeping dsh's capabilities |
| [Compatibility promise](dsh-compat/COMPAT.md), [gate list](dsh-compat/README.md) | What lyteboat promises dsh plugins, and the gates G1–G6 that prove it |
| [CLAUDE.md](CLAUDE.md) | How to work in this repository: layers, commits, tests, sync rules |
| [CHANGELOG](CHANGELOG.md) | Everything lyteboat provides; it has no releases |

## Repository layout

```
dsh/                  the kernel: the 14 dsh packages dsh/kernel.json lists, under their @deepseek-ai/* names
lyteboat/             lyteboat's 14 packages, one directory per layer
  apps/               processes: the lyteboat launcher
  bundles/            compositions: host (in every profile), run (behind lyteboat run)
  plugins/            capability plugins
  core/               declarations
  agents/             business agents
  tooling/            test infrastructure
examples/agents/      example business agents, built on the distribution
dsh-compat/           the compatibility promise and its proof: contract snapshot, extension registry, G2/G4/G5/G6 tests
scripts/              layer, pin, and sensitive-word checks; dist/ holds the distribution tooling
docs/                 the guides
dsh.upstream.json     the tracked dsh release
```

Dependencies point down only: `apps` → `bundles` → `plugins` → `core`; `examples` depend on `plugins` and `core` only (their tests may also reach `apps`, `bundles`, `tooling`), and nothing in the distribution depends on them; `tooling` is for tests. `pnpm run lint` checks it.

| Path | Package | Role |
|---|---|---|
| `lyteboat/apps/cli` | `@lyteboat/cli` | The `lyteboat` launcher: profile templates, patch stack, boot (adapted from dsh's CLI) |
| `lyteboat/bundles/host` | `@lyteboat/host` | The host bundle every profile lists: the distribution marker and the capability plugins' service rows |
| `lyteboat/bundles/run` | `@lyteboat/run` | The one-shot bundle behind `lyteboat run`: task, `--agent`, `--agents`, `--history`, `--session-id`, `--context`; a request is admitted before the loop, and the output composes the turn's cards |
| `lyteboat/plugins/distro` | `@lyteboat/distro` | The `lyteboatDistro` service: the dsh release the kernel came from and the kernel extensions this build carries |
| `lyteboat/plugins/tool-policy` | `@lyteboat/tool-policy` | Tool visibility, confirmation, and state deltas; `./agent` declares policy in an agent's composition file, and its `undeclared: always \| auto` sets whether the inherited tools it does not name are visible |
| `lyteboat/plugins/aux-llm` | `@lyteboat/aux-llm` | Side model calls (skill routing, intake classification), each under its own deadline and recorded in the session as an ignorable audit record; an answer cut off at `maxTokens` is a failure; `reasoningEffort` sets the effort side calls request |
| `lyteboat/plugins/request-context` | `@lyteboat/request-context` | The request context: the request a human message answers to (request id, context, admission verdict) rides its own source; the `lyteboatRequest` projection keeps the session's context |
| `lyteboat/plugins/intake-guard` | `@lyteboat/intake-guard` | Admission ahead of the loop: an agent registers an admission function, and the caller submits each request with `submit`, which admits it and records the request with its verdict; the loop answers a recorded reply verdict directly and admits in the loop what arrives unadmitted |
| `lyteboat/plugins/skill-router` | `@lyteboat/skill-router` | Skill load modes and model routing (`historyWindow`, `timeoutMs`, `maxTokens` configurable); `./agent` declares the mode in an agent's composition file |
| `lyteboat/plugins/a2ui` | `@lyteboat/a2ui` | The A2UI template engine, the `render_a2ui` tool, and the `lyteboatCards` projection; a result may carry several cards, laid into the turn by emission mode (immediate, deferred, deferred-discard) and the answer's `[[card:<area>]]` markers (`turnParts`); `./agent` mounts the tool from a composition file, and an agent's own tools render cards with `renderCard`, `cardsPresentationMeta`, and `cardMarker`; the default component catalog carries no business vocabulary |
| `lyteboat/plugins/history-import` | `@lyteboat/history-import` | Parsing of external conversation history and the session seed behind `lyteboat run --history` |
| `lyteboat/core/contracts` | `@lyteboat/contracts` | lyteboat's declarations over the dsh seams: tool and skill metadata, the kernel's `lyteboat/*` events (re-exported), log nodes, projection keys, prompt orders, `LyteboatDistro`, and the zod schemas of the JSON types it declares |
| `examples/agents/finance` | `@lyteboat/agent-finance` | The finance agent, kept deliberately minimal and built from public financial knowledge only: an asset overview, an allocation diagnosis by the 100-minus-age rule (two cards), investor education on three concepts; three routed skills; requests are admitted before the loop (the unauthorized card, an out-of-scope reply, investor education and small talk always in), and the request context names the customer |
| `lyteboat/tooling/testing` | `@lyteboat/testing` | Test infrastructure: the unit host (dsh's invariants, the dsh services, the kernel's agent loop) and `MockAdapter`, in-process composition boots, per-file scratch homes and workspaces, the session-log reader and its reopen check, the scripted model, launcher processes |

## Development

| Command | What it does |
|---|---|
| `pnpm run build` | Builds every package and bundles the kernel the way upstream does |
| `pnpm run test` | Build, the G1 contract check, unit, composition, and e2e tests, upstream's kernel tests (G2); what CI runs |
| `pnpm run lint` | oxlint, knip (declared dependencies and dead exports), the layer check, the distribution manifest check, the sensitive-word check |
| `pnpm run typecheck` | Type-checks sources and tests |
| `pnpm run dsh-compat` | G4–G6: installs the official release and lyteboat side by side outside the repository and compares them (needs the network) |
| `pnpm run check` | lint + test + dsh-compat |
| `pnpm run dist:delta` | Lists what lyteboat carries on top of the imported dsh tag |

Syncing a new dsh release, promoting a package into the kernel, and running G3 and the persistence gate are covered in the [distribution conventions](docs/02-distribution.md).

### Why the pnpm settings look unusual

- **Reinstall from a clean `node_modules` after adding or moving a workspace package.** An incremental `pnpm install` keeps stale hoisted links.
- **`publicHoistPattern: ['@deepseek-ai/*', '@lyteboat/*']`.** An agent's composition file names its rows by bare package name, resolved from the agent directory upward, and the composition tests resolve rows from the repository root; under pnpm's isolated layout both reach the dsh and lyteboat packages only at the root `node_modules`. The launcher itself resolves rows through dsh's runtime resolution of `lyteboat/apps/cli`'s dependency graph.
- **`overrides`.** Every kernel package name resolves to its workspace copy under `dsh/`, for lyteboat's packages and for every npm package that depends on it, so the graph holds one instance of each: lyteboat's. `rolldown` is held at the version upstream's lockfile resolves, so the kernel bundles build byte for byte as npm publishes them.
- **`.pnpmfile.cjs`.** Published dsh packages depend on each other with caret ranges, so an unpinned install drifts to a newer prerelease than the tracked tag. It leaves the kernel names alone: it runs after the overrides and would undo them.
- **dsh peers are exact versions.** A lyteboat package writes a non-kernel dsh peer as the tracked release's exact version, not `catalog:dsh`: dsh's startup admission reads a row's dsh peers from the manifest on disk, where pnpm never resolves `catalog:`, and disables a row whose peers it cannot match. `scripts/upstream-pins.spec.ts` keeps them equal to `dsh.upstream.json`.
- **`minimumReleaseAgeExclude`.** pnpm 11 refuses packages younger than a day; a dsh release pinned on its first day is listed there by exact version, and the entries can go once the release has aged.
- **`allowBuilds`.** pnpm 11 blocks install scripts unless listed; only node-pty's helper chmod is needed on Linux and macOS.

## Status and roadmap

- Tracks dsh **0.1.7-rc.2** (`dsh.upstream.json`). The kernel is its import plus lyteboat's three registered extensions (`agent-loop-intake`, `agent-loop-pre-assemble`, `session-append-ignorable`), and every gate above passes against it.
- Provides: the launcher and profiles; the capability plugins tool-policy, skill-router, a2ui, aux-llm, request-context, intake-guard, and history-import; the finance agent; continuation (`--session-id`) and request context (`--context`); the distribution tooling and the 13-package kernel; the compatibility gates G1–G6. The [CHANGELOG](CHANGELOG.md) has the full list.
- Known limitations:
  - There is no server mode (`/chat`, multiple users). `lyteboat web` does not read agent directories, and a message arriving through it is admitted in the loop without a recorded verdict.
  - There is no memory and there are no suggested questions. Side calls use the agent's own model by default; skill routing can name its own provider and model in the `@lyteboat/skill-router/agent` row, intake classification cannot yet.
- What comes next: the forward plan in the [alignment analysis](docs/04-reference-alignment.md).

## Contributing

- Read [CLAUDE.md](CLAUDE.md) first: layer rules, test requirements, commit message format. A change under `dsh/` is a classified commit with a `Dist-Change:` trailer; read the [compatibility promise](dsh-compat/COMPAT.md) before touching `dsh/`.
- Before committing, run `pnpm run lint`, `pnpm run typecheck`, and `pnpm run test`; after a kernel or compatibility change, also `pnpm run dsh-compat`.
- A plugin outside this repository that uses a lyteboat extension declares `inject: ['lyteboatDistro']`, so it stays unloaded on the official release.
- Merge pull requests with a merge commit, not a squash or a rebase: the upstream line is found through the `Dist-Import` trailer of the import commits.

## License

lyteboat is released under the [MIT License](LICENSE). The kernel packages under `dsh/` and the files marked "Adapted from deepseek-ai/deepseek-harness" keep DeepSeek's MIT copyright notice; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Acknowledgements

lyteboat is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its Cordis plugin system.
