# Changelog

lyteboat has no releases yet; this file records what each milestone delivered, newest first. The tracked dsh release is in `dsh.upstream.json`.

## One name: lyteboat

- The project, its packages (`@lyteboat/*`), its directory (`lyteboat/`), and its CLI (`lyteboat`) share one name; data lives under `$LYTEBOAT_HOME` (default `~/.lyteboat`).
- The protocol follows: log nodes and events `lyteboat/*`, projection keys `lyteboat*`, tool result meta `meta.lyteboat`, SKILL.md frontmatter `metadata.lyteboat`, the distro service `lyteboatDistro`. Nothing ran on the old names, so nothing is migrated.

## Kernel promotion

- `llm/llm` (`@deepseek-ai/dsh-llm`) and `skill/skill` (`@deepseek-ai/dsh-skill`) joined the kernel, so the capabilities every composition needs to start (model access, tools, skills, sessions) are lyteboat's own source: 13 packages, under the same gates.
- A package that publishes Typert files brings the published files with its import; `pnpm run dist:overlay <checkout> typert` checks them against upstream's generator.

## Sync to dsh 0.1.7-rc.1

- The kernel is the rc.1 import plus lyteboat's two extensions, and every gate passes against it.
- A non-kernel dsh peer of a lyteboat package is the tracked release's exact version, because dsh's startup admission reads peers from the manifest on disk.
- `compatibility/` holds the promise (`COMPAT.md`, the contract snapshot, the extension registry) and its proof (the G2 harness and the G4–G6 tests); `pnpm run compatibility` runs G4–G6.

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

- `scripts/dist`: the contract snapshot of the tracked dsh release (`compatibility/contract/`), the per-tag import commit, the delta report, the overlay gates.

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
