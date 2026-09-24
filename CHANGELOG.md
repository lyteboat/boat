# Changelog

lyteboat has no releases yet; this file records what each milestone delivered, newest first. The tracked dsh release is in `dsh.upstream.json`.

## F2 — request context, admission ahead of the loop, side calls, cards

- Kernel extension `session-append-ignorable` (`@deepseek-ai/dsh-session`): `Session.append(type, data, { ignorable: true })` marks a record of a type the harness does not know, so dsh's persistence, and the official release, read a log past it; a type the harness knows refuses the mark.
- `@lyteboat/aux-llm`: side model calls (the router's, an admission's classifier), each under its own deadline and recorded as an ignorable `lyteboat/aux-llm-call` (route, system, prompt, answer or failure, duration). A failure is an outcome the caller falls back on, and an answer cut off at `maxTokens` is one; `reasoningEffort` sets the effort every side call requests. The router's calls are recorded again.
- `@lyteboat/a2ui`: a tool result carries several cards (`meta.lyteboat.cards`), each with its area and emission mode (`immediate`, `deferred`, `deferred_discard`). `turnParts` composes a finished turn: immediate cards first, then the answer with each `[[card:<area>]]` marker replaced by that area's deferred cards, then, when the turn completed, the deferred cards the answer did not place. `lyteboat run` prints a card as a `[card <area>]` line.
- `@lyteboat/request-context`: the request a human message answers to (request id, context, admission verdict) rides its source (`source.lyteboatRequest`), and the `lyteboatRequest` projection keeps the session's context until a request brings another. `lyteboat run --context <json|file>` passes one.
- `@lyteboat/intake-guard`: an agent registers an admission function; `lyteboat run` admits a request before it enters the loop and records the verdict on it; a reply verdict (text and cards) answers the turn without a model request, and a message that arrives unadmitted is admitted in the loop.
- `@lyteboat/agent-finance` drops V1's stand-ins: the request context names the customer (`context.customer`), and cards ride `meta.lyteboat.cards` with their emission modes, placed by markers. Its admission classifies each request with a side call: investor education and small talk pass, a request about the customer's money passes once an account is authorized and otherwise gets the unauthorized card, anything else gets the service scope; a failed classification lets the request through.

## F1 — multi-turn and reopen

- `@lyteboat/skill-router` writes no node of its own. A routed skill's body enters the step as dsh's skill-invocation message (the record dsh-tool-skill writes when a user invokes a skill), and `lyteboatActiveSkill` folds those messages and successful `skill` tool calls, so a routed session reopens under dsh's persistence and `lyteboat web`, a continued session gets its tools back, and a body the model no longer sees is injected again. The router call leaves a debug log line.
- `lyteboat run --session-id <id>` continues a stored session under the agent it ran with; every run prints its session id to stderr.
- `@lyteboat/host` turns off dsh-base's `session-telemetry-otel` export, which would send a session-log prefix upstream after user feedback.
- `lyteboatState` and `lyteboatCards` fold appended tool results only: a surface replacement keeps the original meta and no longer applies its delta or card a second time.

## V1 — a finance agent on the core as it stands

- `@lyteboat/agent-finance`, built from public financial knowledge only: asset overview, allocation diagnosis, a one-bucket drill-down, and investor education; four routed skills, six cards, the session's facts in an agent-level projection, and tool results aged to their facts once their turn is over. It ran with no kernel change, with three stand-ins for what the core lacked: the customer comes from an environment variable, a result's extra cards ride private meta, and card markers stay in the answer text.
- `scripts/check-sensitive.ts` keeps a word list supplied through the environment out of every tracked path and file; `pnpm run lint` runs it.

## One name: lyteboat

- The project, its packages (`@lyteboat/*`), its directory (`lyteboat/`), and its CLI (`lyteboat`) share one name; data lives under `$LYTEBOAT_HOME` (default `~/.lyteboat`).
- The protocol follows: log nodes and events `lyteboat/*`, projection keys `lyteboat*`, tool result meta `meta.lyteboat`, SKILL.md frontmatter `metadata.lyteboat`, the distro service `lyteboatDistro`. Nothing ran on the old names, so nothing is migrated.
- The promise to dsh plugins and its proof live in `dsh-compat/` (was `compatibility/`), and `pnpm run dsh-compat` runs G4–G6.

## Kernel promotion

- `llm/llm` (`@deepseek-ai/dsh-llm`) and `skill/skill` (`@deepseek-ai/dsh-skill`) joined the kernel, so the capabilities every composition needs to start (model access, tools, skills, sessions) are lyteboat's own source: 13 packages, under the same gates.
- A package that publishes Typert files brings the published files with its import; `pnpm run dist:overlay <checkout> typert` checks them against upstream's generator.

## Sync to dsh 0.1.7-rc.1

- The kernel is the rc.1 import plus lyteboat's two extensions, and every gate passes against it.
- A non-kernel dsh peer of a lyteboat package is the tracked release's exact version, because dsh's startup admission reads peers from the manifest on disk.
- `dsh-compat/` holds the promise (`COMPAT.md`, the contract snapshot, the extension registry) and its proof (the G2 harness and the G4–G6 tests); `pnpm run dsh-compat` runs G4–G6.

## D2 — compatibility against the official release

- G4: the same scripted run writes the same session log on official dsh and on lyteboat.
- G5: 23 pinned community plugins install with `dsh plugin add` and bind to lyteboat's kernel.
- G6: sessions written by either side reopen and continue on the other.
- G3 (upstream's cross-package tests on lyteboat's kernel) and the persistence gate run in the sync pipeline (`pnpm run dist:overlay`).

## D1 — the kernel

- 11 dsh packages imported under `dsh/` and resolved by name for the whole dependency graph; their builds match the published bundles.
- G1 (contract) and G2 (upstream's kernel tests, unmodified) run in `pnpm run test`.
- lyteboat's step hooks are two registered extensions of the kernel's agent loop (`lyteboat/intake`, `lyteboat/pre-assemble`); the driver fork and `--driver` are gone.
- `@lyteboat/distro` publishes the `lyteboatDistro` marker; lyteboat's packages moved under `lyteboat/<layer>/`.

## D0 — distribution tooling

- `scripts/dist`: the contract snapshot of the tracked dsh release (`dsh-compat/contract/`), the per-tag import commit, the delta report, the overlay gates.

## M2 — lyteboat's own plugins

1. `@lyteboat/contracts` and the intake path (`lyteboat/intake`, `lyteboat/pre-assemble`), plus `--plugin <file>`.
2. `@lyteboat/run`, the one-shot runner, composing an agent from its directory (`lyteboat run --agents ./lyteboat/agents --agent <id> "task"`).
3. `@lyteboat/tool-policy`: tool visibility (`always`/`auto` and activation), confirmation through the approval seam, and tool-result state deltas folded into the `lyteboatState` projection.
4. `@lyteboat/skill-router`: the reference skill load modes over the dsh skill registry. `full` puts every skill body in the system prompt; `dynamic` routes each user input through a side model call (the reference router prompt, sticky on null and errors), puts the active skill's body and required tools into the same step, and records `lyteboat/route-request` and `lyteboat/skill-routed`.
5. `@lyteboat/a2ui`: the reference A2UI template engine ported field for field (manifest resolution, transforms DSL, walker, contract validation, checked against payloads the reference implementation produced for the same templates), the `render_a2ui` tool, and the `lyteboatCards` projection.
6. `@lyteboat/history-import`: external conversation history (rounds by trace id, half and malformed rounds dropped, ordered by create time) turned into a session seed of closed turns (`lyteboat run --history <file>`).
7. `lyteboat/agents/demo`: the demo agent (persona, two routed skills, an asset tool that fills the state and renders the card in one call, a diagnosis tool, an intake gate) and the M2 acceptance over it.

## M1 — step hooks

- A fork of dsh-agent-loop carrying lyteboat's step hooks, proven log-equivalent to the official driver; retired in D1, when the hooks moved into the kernel's own agent loop.

## M0 — runnable skeleton

- `lyteboat run` and `lyteboat web` boot the official dsh bundles through lyteboat's own launcher.
