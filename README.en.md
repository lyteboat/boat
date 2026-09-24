# boat

[![CI](https://github.com/lyteboat/boat/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/lyteboat/boat/actions/workflows/ci.yml)

[中文](README.md) | **English**

> **Harness for business, built on DeepSeek Harness.**

boat (轻舟) is a harness for business agents built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). It is not a coding agent: it is a production-ready, out-of-the-box harness that gets the work done, does it right, and leaves a trace.

- [Why boat](#why-boat)
- [Features](#features)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Documentation](#documentation)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Status and roadmap](#status-and-roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why boat

The model is the engine, not the harvester: however strong the engine, it brings in no grain until a purpose-built header is mounted on it.

Every industry faces the same situation today. Model capability is no longer the bottleneck; wiring the model into real business and closing the last mile is. The last mile holds no new algorithm, only concrete questions: which tools the model sees at which step, which operations need a person's confirmation first, whose business state is authoritative, how a result reaches the user as a business interface, and how to reconstruct what the model saw when something goes wrong. Every industry team answers them again from scratch.

boat turns that last mile into a reusable chassis for vertical agents. A team adds its business skills, tools, and card templates and gets an agent that can go to production.

## Features

- **Business capabilities out of the box**, as Cordis plugins on dsh's seams; the framework packages carry no business vocabulary:
  - Skill routing: `full` puts every skill body in the prompt; `dynamic` picks a skill with a side model call each turn and applies it in the same step (`@boat/skill-router`).
  - Tool visibility, confirmation before a call, and state deltas carried by tool results (`@boat/tool-policy`).
  - A2UI template cards (`@boat/a2ui`).
  - Import of external conversation history (`@boat/history-import`).
  - An intake gate that answers a turn without a model request (`boat/intake`).
- **One business agent is one directory.** Write its composition file, skills, tools, and card templates under `boat/agents/<id>/`.
- **Compatible with the dsh ecosystem.** boat is a distribution of dsh: it owns the source of dsh's 13 kernel packages under their published names (`dsh/`), so official packages and community plugins run on boat's implementation unchanged. It keeps the protocol, interfaces, and behavior of the dsh release it tracks, and six gates, G1–G6, prove it ([`compatibility/`](compatibility/README.md)).
- **Traceable.** Everything a model sees is reconstructable from the session log, and every fact boat records rides an envelope dsh already knows.

## Quick start

### Requirements

- Node.js 22.19+ or 24+
- pnpm 11.7 (`corepack enable` picks up the version pinned in `package.json`)

### Install and build

```sh
git clone https://github.com/lyteboat/boat.git
cd boat
corepack enable
pnpm install
pnpm run build
```

The launcher is `boat/apps/cli/lib/bin.js`; the examples below call it `boat`:

```sh
alias boat="node $PWD/boat/apps/cli/lib/bin.js"
```

### Configure the model

boat uses dsh's model settings: set `DEEPSEEK_API_KEY` in the environment or in `$BOAT_HOME/.env`. `DEEPSEEK_BASE_URL` is optional and points to an endpoint that speaks DeepSeek's Anthropic-compatible Messages API.

### Run

```sh
boat run "summarize this workspace"                       # one-shot task: answer and exit
boat run --agents ./boat/agents --agent demo "看看资产"    # the demo agent: routed skill, asset tool, card
boat web --no-open                                        # browser UI
```

## Usage

### Commands

| Command | What it does |
|---|---|
| `boat run [options] "task"` | Answers one task, prints the result, and exits (profile `run`) |
| `boat web [options]` | Serves the browser UI (profile `web`); `boat web --help` lists its own flags |
| `boat config dump [options]` | Prints the composed plugin tree and exits; `--default` shows the bundle layers only |

All three accept:

| Option | What it does |
|---|---|
| `--profile <name>` | The profile under `$BOAT_HOME/profiles` to boot |
| `--patch <path>` | An extra patch layer applied after the profile layer (repeatable) |
| `--plugin <file>` | Inserts a local ESM plugin file as a row of the tree (repeatable) |

`boat run` also takes:

| Option | What it does |
|---|---|
| `--agents <dir>` | A directory of agents (repeatable) |
| `--agent <id>` | Runs one agent from those directories (`--preset` is a deprecated alias) |
| `--history <file>` | Imports external conversation history first; the task becomes its next turn |

`boat run -h` lists every flag of the one-shot mode.

### Writing a business agent

A business agent is a directory `boat/agents/<id>/`, named by its id:

- `agent.cordis.yml` (required): the plugin rows for persona, skill routing, tools, and policy; each row applies to this agent's sessions only.
- `preset.yml`: display information such as the name.
- `skills/`: one `SKILL.md` per skill.
- `a2ui/`: card templates.
- `src/`: business code, compiled to `lib/` and loaded by `./lib/x.js` rows of the composition file.

The [agent development guide](docs/03-agent-development.md) walks through every step with a runnable example; [`boat/agents/demo`](boat/agents/demo) is a working agent.

### Data and session logs

- All boat data lives under `$BOAT_HOME` (default `~/.boat`). The launcher exports that directory as `DSH_HOME` before any dsh package loads, so your own `~/.dsh` is never touched.
- The session log is the single source of truth. A card and a state delta sit on `tool/result.meta.boat`, an intake reply is an assistant message whose `source.provider` is `boat`, and imported history is closed turns of ordinary nodes, so these sessions reopen under dsh's own persistence.
- `@boat/host` turns off dsh-base's `session-log-deepseek` row: the model provider receives the request and nothing else.

## Documentation

The guides are written in Chinese.

| Document | What it covers |
|---|---|
| [Architecture](docs/01-architecture.md) | C4 layers, the startup sequence, lifecycle and dependency injection, the flow of one request, the order of the session log |
| [Distribution conventions](docs/02-distribution.md) | The kernel and the upstream line, a sync step by step, change classes, promotion, how to run each gate, branches and channels, versions and pins |
| [Agent development](docs/03-agent-development.md) | Building a business agent from scratch (example: `policy-desk`): directory, composition, skills, tools, policy, tests, running it |
| [Alignment with the reference implementation](docs/04-reference-alignment.md) | Which capabilities of the reference implementation to bring in, and how to redesign the core while keeping dsh's capabilities |
| [Compatibility promise](compatibility/COMPAT.md), [gate list](compatibility/README.md) | What boat promises dsh plugins, and the gates G1–G6 that prove it |
| [CLAUDE.md](CLAUDE.md) | How to work in this repository: layers, commits, tests, sync rules |
| [CHANGELOG](CHANGELOG.md) | What each milestone delivered |

## Repository layout

```
dsh/                  the kernel: the 13 dsh packages dsh/kernel.json lists, under their @deepseek-ai/* names
boat/                 boat's own packages, one directory per layer
  apps/               processes: the boat launcher
  bundles/            compositions: host (in every profile), run (behind boat run)
  plugins/            capability plugins
  core/               declarations and shims
  agents/             business agents
  tooling/            test infrastructure
compatibility/        the compatibility promise and its proof: contract snapshot, extension registry, G2/G4/G5/G6 tests
scripts/              layer and pin checks; dist/ holds the distribution tooling
docs/                 the guides
dsh.upstream.json     the tracked dsh release
```

Dependencies point down only: `apps` → `bundles` → `plugins` → `core`; `agents` depend on `plugins` and `core` only; `tooling` is for tests. `pnpm run lint` checks it.

| Path | Package | Role |
|---|---|---|
| `boat/apps/cli` | `@boat/cli` | The `boat` launcher: profile templates, patch stack, boot (adapted from dsh's CLI) |
| `boat/bundles/host` | `@boat/host` | The host bundle every profile lists: the distribution marker and the capability plugins' service rows |
| `boat/bundles/run` | `@boat/run` | The one-shot bundle behind `boat run`: task, `--agent`, `--agents`, `--history` |
| `boat/plugins/distro` | `@boat/distro` | The `boatDistro` service: the dsh release the kernel came from and the kernel extensions this build carries |
| `boat/plugins/tool-policy` | `@boat/tool-policy` | Tool visibility, confirmation, and state deltas; `./agent` declares policy in an agent's composition file |
| `boat/plugins/skill-router` | `@boat/skill-router` | Skill load modes and model routing; `./agent` declares the mode in an agent's composition file |
| `boat/plugins/a2ui` | `@boat/a2ui` | The A2UI template engine, the `render_a2ui` tool, and the `boatCards` projection; `./agent` mounts the tool from a composition file |
| `boat/plugins/history-import` | `@boat/history-import` | Parsing of external conversation history and the session seed behind `boat run --history` |
| `boat/core/contracts` | `@boat/contracts` | boat's declarations over the dsh seams: tool and skill metadata, the kernel's `boat/*` events (re-exported), log nodes, `BoatDistro` |
| `boat/core/cordis-compat` | `@boat/cordis-compat` | Runtime values for const enums the published cordis build erases |
| `boat/agents/demo` | `@boat/agent-demo` | The demo agent: composition file, two routed skills, an asset tool, card templates, an intake gate |
| `boat/tooling/testing` | `@boat/testing` | Test infrastructure: dsh service mounting and `MockAdapter`, the session-log reader, the scripted model, launcher processes |

## Development

| Command | What it does |
|---|---|
| `pnpm run build` | Builds every package and bundles the kernel the way upstream does |
| `pnpm run test` | Build, the G1 contract check, unit, composition, and e2e tests, upstream's kernel tests (G2); what CI runs |
| `pnpm run lint` | oxlint, knip, the layer check, the distribution manifest check |
| `pnpm run typecheck` | Type-checks sources and tests |
| `pnpm run compatibility` | G4–G6: installs the official release and boat side by side outside the repository and compares them (needs the network) |
| `pnpm run check` | lint + test + compatibility |
| `pnpm run dist:delta` | Lists what boat carries on top of the imported dsh tag |

Syncing a new dsh release, promoting a package into the kernel, and running G3 and the persistence gate are covered in the [distribution conventions](docs/02-distribution.md).

### Why the pnpm settings look unusual

- **Reinstall from a clean `node_modules` after adding or moving a workspace package.** An incremental `pnpm install` keeps stale hoisted links.
- **`publicHoistPattern: ['@deepseek-ai/*', '@boat/*']`.** An agent's composition file names its rows by bare package name, resolved from the agent directory upward, and the composition tests resolve rows from the repository root; under pnpm's isolated layout both reach the dsh and boat packages only at the root `node_modules`. The launcher itself resolves rows through dsh's runtime resolution of `boat/apps/cli`'s dependency graph.
- **`overrides`.** Every kernel package name resolves to its workspace copy under `dsh/`, for boat's packages and for every npm package that depends on it, so the graph holds one instance of each: boat's. `rolldown` is held at the version upstream's lockfile resolves, so the kernel bundles build byte for byte as npm publishes them.
- **`.pnpmfile.cjs`.** Published dsh packages depend on each other with caret ranges, so an unpinned install drifts to a newer prerelease than the tracked tag. It leaves the kernel names alone: it runs after the overrides and would undo them.
- **dsh peers are exact versions.** A boat package writes a non-kernel dsh peer as the tracked release's exact version, not `catalog:dsh`: dsh's startup admission reads a row's dsh peers from the manifest on disk, where pnpm never resolves `catalog:`, and disables a row whose peers it cannot match. `scripts/upstream-pins.spec.ts` keeps them equal to `dsh.upstream.json`.
- **`minimumReleaseAgeExclude`.** pnpm 11 refuses packages younger than a day; a dsh release pinned on its first day is listed there by exact version, and the entries can go once the release has aged.
- **`allowBuilds`.** pnpm 11 blocks install scripts unless listed; only node-pty's helper chmod is needed on Linux and macOS.

## Status and roadmap

- Tracks dsh **0.1.7-rc.1** (`dsh.upstream.json`). The kernel is its import plus boat's two registered extensions (`boat/intake`, `boat/pre-assemble`), and every gate above passes against it.
- Delivered: the launcher and profiles; the capability plugins tool-policy, skill-router, a2ui, history-import, and the intake gate; the demo agent; the distribution tooling and the 13-package kernel; the compatibility gates G1–G6. See the [CHANGELOG](CHANGELOG.md) for each milestone.
- Known limitations:
  - A session that routed a skill cannot yet be opened or resumed in `boat web`: `boat/skill-routed` and `boat/route-request` have no dsh envelope, so dsh's persistence refuses the log (`boat/bundles/run/tests/reopen.composite.ts` pins this).
  - There is no server mode yet (`/chat`, multiple users), and `boat web` does not read agent directories.
- What comes next: the roadmap in the [alignment analysis](docs/04-reference-alignment.md#6-路线图从-d3-开始).

## Contributing

- Read [CLAUDE.md](CLAUDE.md) first: layer rules, test requirements, commit message format. A change under `dsh/` is a classified commit with a `Dist-Change:` trailer; read the [compatibility promise](compatibility/COMPAT.md) before touching `dsh/`.
- Before committing, run `pnpm run lint`, `pnpm run typecheck`, and `pnpm run test`; after a kernel or compatibility change, also `pnpm run compatibility`.
- A plugin outside this repository that uses a boat extension declares `inject: ['boatDistro']`, so it stays unloaded on the official release.
- Merge pull requests with a merge commit, not a squash or a rebase: the upstream line is found through the `Dist-Import` trailer of the import commits.

## License

boat's own code does not declare a license yet. The kernel packages under `dsh/` and a few adapted files come from DeepSeek Harness under the MIT License; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Acknowledgements

boat is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its Cordis plugin system.
