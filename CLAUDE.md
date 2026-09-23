# boat

boat is an agent harness built as Cordis plugins on top of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). It is the TypeScript successor of ark-agentic: ark's runtime facts (skill routing, tool visibility, A2UI cards, session state, external history) are re-expressed as plugins on dsh's seams, so boat stays compatible with the dsh plugin ecosystem. dsh is pinned to one release (`dsh.upstream.json`); the design document (the boat artifact) owns the roadmap and the per-milestone acceptance log, this file owns how to work in the repository.

Read [README.md](README.md) for what runs today. Read `packages/agentic-loop/UPSTREAM.md` before touching the driver fork. When a dsh API is unclear, read its source in the pinned checkout (`packages/<group>/<pkg>/src`) rather than guessing from the published `lib/`.

## Stack

TypeScript 6 (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), ESM only, Node ^22.19 || >=24 · pnpm 11 workspaces (`apps/*`, `packages/*`, `packages/bundle/*`, `agents/*`) · `tsc -b` with project references · vitest 4 (unit + e2e in one runner) · oxlint (`correctness` = error) · Cordis 4 IoC (`@deepseek-ai/cordis`) · dsh 0.1.5-alpha.2 packages as peer dependencies · `@deepseek-ai/schemastery` for plugin `Config`, zod for projection state schemas.

## Repository layout

```
apps/cli/                 @boat/cli — the `boat` launcher: profile templates, patch stack, boot (adapted from dsh's CLI)
packages/
  cordis-compat/          @boat/cordis-compat — runtime values for const enums the published cordis build erases
  contracts/              @boat/contracts — boat's declarations over the dsh seams: tool/skill metadata, boat/* events, log nodes, projection keys
  agentic-loop/           @boat/agentic-loop — the boat driver, a fork of dsh-agent-loop (UPSTREAM.md lists every boat change)
  tool-policy/            @boat/tool-policy — visibility always/auto + activation, confirmation, state deltas → boatState projection
  skill-router/           @boat/skill-router — skill load modes full/dynamic, ark's LLM router, boatActiveSkill projection
  a2ui/                   @boat/a2ui — ark's A2UI template engine, the render_a2ui tool, boatCards projection
  history-import/         @boat/history-import — SA history → session seed of closed turns
  bundle/run/             @boat/run — the one-shot bundle behind `boat run` (cordis.patch.yml, startup flags, the runner)
agents/
  demo/                   @boat/agent-demo — a preset directory: preset.yml, agent.cordis.yml, skills/, a2ui/, fixtures/, src/ → lib/
examples/                 runnable plugin files for `boat run --plugin <file>`; each directory is its own private package
tooling/
  testing/                @boat/testing — the test harness every package's tests use: mountDshTestServices + MockAdapter, session-log, scripted-model, process
  dsh-agent-loop-testkit-fork/  @boat/dsh-agent-loop-testkit-fork — verbatim fork of agent-loop-testkit, only for the driver's synced upstream tests
scripts/                  sync-upstream.ts (re-fork from the pinned tag), upstream-pins.spec.ts; type-checked by tsconfig.tests.json, not built
dsh.upstream.json         the pinned dsh release; .pnpmfile.cjs pins every dsh and cordis package to it
```

Three tiers, following dsh's own split (`apps/*` beside `packages/bundle/*`): `apps/*` owns a process — `apps/cli` owns the `boat` bin and nothing else does; `packages/bundle/*` are compositions, a `cordis.patch.yml` a profile includes by name, with no bin of their own; `packages/*` are the capability libraries those compositions wire together. A new runnable mode (`boat web`, an SDK entry) is a new `packages/bundle/<name>`, not a second app and not a branch inside `@boat/run`.

Each package has `src/` (compiled to `lib/`, gitignored), `tests/`, its own `tsconfig.json` with `references` to every workspace package it imports, an entry in the root `tsconfig.json`, and a package.json `exports` entry per public subpath (`@boat/x`, `@boat/x/preset`, …) whose first key is the `@boat/source` condition pointing at `src/*.ts`. `exports` is the only resolution table: `tsconfig.base.json` sets `customConditions: ['@boat/source']` and `vitest.config.ts` sets the same resolve condition, so typecheck and tests read `src`; Node, the built CLI (`apps/cli/lib/bin.js`), and cordis compositions use the default conditions and load `lib/`. There is no `paths` table.

## Architecture boundaries

Dependencies flow downward only:

```
agents/*                        ← business logic and presets; may depend on any boat plugin
packages/{tool-policy, skill-router, a2ui, history-import}   ← boat plugins; depend on contracts + dsh seams, never on each other's implementation
packages/contracts              ← types, constants, declaration merging only; no runtime behavior
packages/agentic-loop            ← the driver fork; knows contracts' events, knows no boat plugin
packages/bundle/run · apps/cli         ← composition roots: they wire, they do not implement behavior
@deepseek-ai/dsh-*              ← the seams: tools, skills, llm, sessions, sessionProjections, systemPrompt, approval, agents, presets
```

Hard rules:

- **contracts is the only shared declaration home.** A new event, log node, projection key, or metadata field is declared once in `@boat/contracts` (declaration merging onto dsh's `Events` / `SessionEventMap` / `SessionProjectionStateMap`). A plugin that needs another plugin's data reads it through a projection or a service `inject`, never through a shared module.
- **Plugins sit on dsh seams; they do not re-implement them.** Tools go through `ctx.tools`, skills through `ctx.skills`, model calls through `ctx.llm`, state through `ctx.sessionProjections`, prompt text through `ctx.systemPrompt`, confirmation through the approval seam. If a seam is missing, first check whether dsh already has one under a different name.
- **The driver fork carries exactly the boat changes `packages/agentic-loop/UPSTREAM.md` lists** (in `src/agent.ts`: the `boat/intake` waterfall after the inbox claim, the `boat/pre-assemble` waterfall before assembly, `replyStep`, and the first-request series start). Everything else in `packages/agentic-loop` and `packages/agentic-loop-testkit` is upstream verbatim after the identity rewrites in `scripts/sync-upstream.ts`. New behavior is a plugin on those two events or on a dsh event; another change to the fork is a design decision, not a code change: it needs the design document updated first and its line in UPSTREAM.md in the same commit.
- **Composition is data.** `packages/bundle/run/cordis.patch.yml` is the host composition; `agents/<id>/agent.cordis.yml` is the per-preset composition. Host rows publish services (`@boat/tool-policy`, `@boat/skill-router`, `@boat/a2ui`, `@boat/history-import`); preset rows declare policy against them (`@boat/tool-policy/preset`, `@boat/skill-router/preset`, `@boat/a2ui/preset`, `./lib/x.js`). A preset row must never publish a service into the root realm.
- **Framework packages stay domain-neutral.** `packages/*` know no business vocabulary; asset buckets, personas, and Chinese product copy live under `agents/*`. Strings ported from ark for golden fidelity (error messages, digest formats) are allowed inside `a2ui` and say so in a comment.
- **Model-visible ⟺ logged** (dsh rule, boat inherits it). Anything that reaches a model request is reconstructable from the session log. boat's facts ride dsh envelopes (`tool/result.meta.boat.{card,stateDelta}`, the assistant `source` of a reply); only the skill router's `boat/skill-routed` and `boat/route-request` are boat's own nodes, and a new model-visible input needs the same treatment: an existing envelope first, a new node in contracts only with the persist-and-reopen proof below.
- **A new session event type is proven reopenable before it ships.** dsh's persistence layer refuses a stored log that carries an event type outside its compiled catalog unless the event is marked `ignorable`, and `Session.append` offers no way to set that mark today, so every `boat/*` node currently makes its session unreadable by `boat web` and by resume. Prefer folding a fact into an existing envelope (`tool/result.meta`, the assistant message `source`) over a new node; a new node needs a persist-and-reopen test and an upstream path for the mark, and the design document records both.
- **Registrations are effects.** Every contribution goes through `ctx.effect()` / `ctx.on()` / a registry `register()` that returns the disposer, so an agent scope or a plugin unload leaves nothing behind. Per-agent state lives in a `WeakMap<Agent, …>` or behind the agent scope's disposer, never in a module-level map that outlives the agent.
- **Waterfall listeners MUST call `next()`.** `boat/intake`, `boat/pre-assemble`, `tools/pre-execute`, `tools/post-execute` are waterfalls; returning without `next()` short-circuits every listener behind you. Choose the side of `next()` deliberately: work that must be visible to later listeners in the same step runs before `await next()`, reconciliation runs after.
- **Projections return the same reference when nothing changed.** `apply(state, event)` returns `state` itself for events it ignores; dsh's wire diffing depends on it.

## Coding conventions

- **Tooling**: `pnpm` only (never `npm install`/`yarn`). New dependencies are added to the owning package; dsh and cordis packages are `peerDependencies` (+ `devDependencies`) written as `catalog:dsh` / `catalog:cordis`, never a literal version; the catalogs in `pnpm-workspace.yaml` mirror `dsh.upstream.json` (`scripts/upstream-pins.spec.ts` enforces it). Third-party packages used by more than one workspace package go through the default `catalog:`. Workspace packages use `workspace:*`.
- **ESM everywhere.** Package names across packages, `.ts` extensions in local relative imports (`rewriteRelativeImportExtensions` turns them into `.js` in `lib/`). No CJS-only exports; `.pnpmfile.cjs` is the one CommonJS file and pnpm requires it.
- **Names carry their owner.** `BoatToolMeta` not `Meta`, `boatActiveSkill` not `activeSkill`, `SkillRouterSettings` not `Settings`. Files are named for what they define (`business-payload.ts`, `sa-history.ts`), never `utils.ts` / `helpers.ts` / `types.ts`. Services publish under an unambiguous key (`toolPolicy`, `skillRouter`, `a2ui`, `historyImport`); log nodes and events are `boat/<noun>`; projection keys are `boat<Noun>`.
- **No capability probing.** Never test `'x' in obj` or `typeof obj.x === 'function'` to discover what a value can do. Declare the dependency (`static inject`) or narrow on a discriminant field (`block.type === 'tool_result'`, `decision.kind === 'reply'`). Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Types are strict.** No `any`; no non-null assertions in `src/` (oxlint enforces both). An `as unknown as` cast in `src/` is a boundary crossing (cordis's untyped `baseUrl`, a session envelope built by hand, a business object entering `JsonValue`) and carries a one-line comment naming the boundary. Opaque ids that cross a process or wire boundary keep dsh's branded types.
- **Validate at real boundaries only.** Config (schemastery), model/tool JSON (tool parameter specs), files (history JSON, templates, manifests), and the wire are validated; values a static interface already requires are trusted. A tool's `execute` treats its arguments as untrusted.
- **Misconfiguration fails loud.** Unknown tool names in a policy, an unknown preset, a missing template directory, a malformed manifest, a `Config` that fails its schema: throw at load, or at the earliest point the referent can be resolved. Never silently skip a missing referent. Degradations the design accepts (router timeout keeps the current skill, an unavailable approval channel denies) are logged at `warn` and recorded in the session log where the model would otherwise see a different world.
- **No hardcoded tunables in plugins.** Anything a deployment would change (router timeout, history window, provider/model, template roots, validation strictness) is a validated `Config` field settable from `cordis.yml`. Protocol constants (prompt orders, event names, the ark router prompt, surface-id format) stay fixed constants with a name.
- **Limits**: functions ≤ 160 lines, nesting ≤ 3, inheritance depth ≤ 2 (`Service` subclasses only; prefer composition). Extract on the third repetition, not the first: a helper used by two packages moves to `contracts` only when it is a contract, otherwise it stays local.
- **Logging**: `this.ctx.logger` / `ctx.logger` from cordis, prefixed with the plugin name (`boat skill router: …`). `warn` for handled degradation, `error` only for aborted operations. No `console.*` in `packages/*` or `agents/*`; the CLI writes to stdout/stderr on purpose and says so. Never log credentials, full model requests, or user history.
- **An empty `catch` names what it swallows** and why nothing else can reach it; keep the `try` to one statement.
- Files end with exactly one trailing newline. No `TODO` without an owner and a reason.

### Comments and docstrings

**Default: none. When you write one, it says WHY, not WHAT.**

- **Required**: a module JSDoc (`@module @boat/x`) stating the module's contract in one paragraph; JSDoc on every exported symbol whose contract is not obvious from its signature (`@param` / `@returns` on function-like exports); JSDoc on every event and log node in contracts with its ordering guarantee (which dsh event it precedes or follows).
- **Allowed**: an inline comment for a non-obvious WHY: a dsh quirk (`restrict()` cannot hide a tool registered in the agent's own layer), a Python-semantics emulation kept for golden fidelity, an ordering constraint, a workaround with the upstream reference.
- **Forbidden**: restating the code (`// register the tool`), narrating history or the milestone it came from (that goes in the commit and the design document), review transcripts, `// eslint-disable` / `// oxlint-disable` without a reason on the same line.

```ts
// ❌ // merge the delta into the state
state = mergeStateDelta(state, delta)

// ✅ // dsh computes presentationMeta only for top-level calls, so a subagent's tool never
//    // produces a card; the projection therefore folds `tool/result` meta only at depth 0.
```

## Workflow

### Milestones and steps

boat is delivered one runnable milestone at a time (§9 of the design document), and a large milestone is split into steps that each end with something you can run from the built CLI. Every step follows the same order, and none of it is skipped for speed:

1. **Think.** Read the ark source being ported and the dsh seam it lands on. Write down what is being ported verbatim, what deviates and why, and which dsh rule constrains the design.
2. **Design.** Add the step to the design document (C2 which packages, C3 which services / events / projections, C4 the types and the log nodes) before writing code. When the change touches a public event, a projection key, or the driver fork, stop and confirm with the user.
3. **Review the design** against this file's rules and dsh's AGENTS.md; fix the design, not the code, when a clean test cannot be written.
4. **Implement** with the tests from the [test table](#testing), then `pnpm run check`.
5. **Accept.** Run the milestone's acceptance on the built binary with the scripted model, record the result (what was run, what the log showed) in the design document's acceptance log, and only then commit.

### Task types

**Simple** (`bug` / `chore` / docs / config): fix it, add the regression test, run the gates the change can affect.

**Structural** (`feature` / `refactor` / a new plugin or preset): design top-down through the C4 layers before code: C1 system context (what boat, dsh, the model, and the client see) → C2 containers (launcher, run bundle, driver, plugins, agents, tests) → C3 components (services, events, projections, prompt sections and their orders) → C4 code (types in contracts, hunks, log nodes, event ordering). Confirm with the user when the change touches a public contract or crosses a layer boundary.

**Design deliverable** for a structural task: the design document is a self-contained HTML artifact (mermaid inlined, never a CDN), published through the artifact tool, and never committed under the repository. It must contain the C4 diagrams, the step-by-step flow (one driver step with intake, pre-assemble, routing, activation, assembly; one tool call with state delta and card), the changes-and-impact table, and the acceptance log.

### Scope of change

**Every changed line traces back to the task.** Smaller diff beats tidier diff.

- **Required**: remove imports, helpers, config fields, and events your change orphaned; keep `README.md`'s package table and status in step with the code in the same commit.
- **Allowed**: dead-code removal limited to files you already edit, provably unreferenced, not a public export.
- **Forbidden**: drive-by renames or reformatting, refactors of working code outside the task, edits to `packages/agentic-loop` beyond what UPSTREAM.md lists, lint fixes in untouched files, changes to `data/`, `.env*`, `.github/`, `dsh.upstream.json`, or `.pnpmfile.cjs` without an explicit instruction.

### Done criteria

Run only the gates the change can affect, and report only the commands you ran.

1. Touched `src/` or `tests/`? `pnpm run check` (lint + build + full vitest run, unit and e2e) passes. `pnpm run test:unit` is the fast loop while iterating.
2. Touched types or a `tsconfig.json`? `pnpm run typecheck` (sources and tests) introduces no new errors.
3. Tests for the new code match the [test table](#testing).
4. Touched anything a user runs (CLI flags, `cordis.patch.yml`, a preset, an example)? Run it once from the built binary (`node apps/cli/lib/bin.js …`) with the scripted model or a real key, and paste the command in the commit or PR.
5. Touched a fork file? `git diff` against the re-synced upstream shows only the boat hunks.
6. Diff is in scope; `README.md` and the design document are current.

## Testing

| Task type | Tests required |
|---|---|
| `feature` / new plugin | Unit: happy path + ≥1 boundary case through the runtime harness (`mountDshTestServices` + `MockAdapter` from `@boat/testing`). E2E: one `apps/cli/tests/<name>.e2e.ts` that runs the built binary with the scripted model and asserts on the session log. |
| port from ark | Golden fixtures generated by ark's Python code, compared with deep equality; each deliberate deviation is a named test. |
| `bug` | Regression test that fails before and passes after. |
| `refactor` | Existing tests pass before and after; no new tests unless behavior moved. |
| `chore` / docs | Skip; run the existing suite if a touched path could regress. |

Conventions:

- **Tests are type-checked, not only transpiled.** `tsc -b` covers `src/` only and vitest strips types, so `pnpm run typecheck` also runs `tsc -p tsconfig.tests.json`; CI runs it.
- **Tests describe behavior, not implementation.** Name them `test('<subject> <does what> when <condition>')`; assert on session-log nodes, projection state, the model request the scripted server recorded, or the tool result, never on private fields.
- **Mock the boundary, not the unit.** The model (`MockAdapter` in unit tests, the scripted OpenAI-compatible server in e2e), the filesystem for skills and templates (fixtures under `tests/fixtures`), the clock when ordering matters. Never mock a boat service to test another boat service; mount both.
- **Unit harness** (`@boat/testing`): `new Context()` + invariant registry + `mountDshTestServices(ctx)` + `ctx.plugin(AgentLoop, { agents: [] })` + the boat services under test + `ctx.llm.registerAdapter(['mock'], adapter)`. Router requests are recognized by their system text, never by call order.
- **E2E** (`apps/cli/tests`): `runBoat` / `startBoat` spawn `apps/cli/lib/bin.js` under plain Node with `BOAT_HOME` in a temp directory; `startScriptedModel` (`@boat/testing/scripted-model`) answers by purpose (loop / title / router) and records every request; `@boat/testing/session-log` reads the log. Tool order in a request is not registration order: sort before asserting.
- **Fixtures**: agent presets under `apps/cli/tests/fixtures/agents/<id>`, templates under `packages/a2ui/tests/fixtures`, ark baselines under `tests/fixtures/baseline`. Fix the fixture, never the normalizer.
- One `test.skip` is acceptable only with a reason string; a skipped new test marks the step ⚠️ partial in the design document.

## Unattended runs

- Work only on the branch the task designates. Never push to `main` / `master` / `develop`; never force-push, rebase, or amend a pushed commit without explicit permission; a rewrite that is permitted uses `--force-with-lease`.
- If the designated branch's PR is already merged, restart the branch from `origin/master` and treat the work as a new change.
- One focused fix attempt on a failing new test. Still failing → mark ⚠️ partial, skip the test with a reason, and say so in the commit and the design document.
- State assumptions in the commit message and the PR description instead of guessing silently; never create a PR unless asked.
- Never modify `.github/`, `dsh.upstream.json`, `.pnpmfile.cjs`, `pnpm-workspace.yaml`, `.env*`, or `packages/agentic-loop` beyond what UPSTREAM.md lists without explicit instruction.
- Commit messages: `<milestone-step>: <package> — <what it delivers>` for milestone work (`M2-3: @boat/tool-policy — …`), conventional `fix:` / `chore:` / `docs:` otherwise, followed by a body that states what runs now and what was accepted. End with the attribution trailers the session provides.
- Never put a model identifier in a commit, PR, code comment, or file.

## Upstream (dsh) pinning

- `dsh.upstream.json` names the dsh version, tag, commit, and the cordis versions; `.pnpmfile.cjs` rewrites every `@deepseek-ai/*` dependency to those versions at install; `pnpm-workspace.yaml` hoists `@deepseek-ai/*` and `@boat/*` because dsh's launcher walks `require.resolve.paths()` from the profile directory.
- **Bumping dsh**: update `dsh.upstream.json` and the `dsh` / `cordis` catalogs in `pnpm-workspace.yaml`, check out the new tag beside the repository, run `node --import tsx scripts/sync-upstream.ts <checkout>`, re-apply the three boat hunks from the diff, update `packages/agentic-loop/UPSTREAM.md` and `THIRD_PARTY_NOTICES.md`, run `pnpm run check`, and run `pnpm run smoke:equivalence` (both drivers must still write identical logs for the same scripted model).
- Files adapted from dsh keep the header `Adapted from deepseek-ai/deepseek-harness` and are listed by that header in `THIRD_PARTY_NOTICES.md`.
- dsh's public APIs are pre-stable: a bump may rename a seam. Update every consumer in the same commit; never keep a compatibility shim.

## Agent and preset design

Read `docs/agent_design_principles.md` in ark-agentic before designing, reviewing, or porting an agent; ark's principles still apply, only the mechanism changed. Prompt changes need eval data; without it they are a working hypothesis and the commit says so.

- A preset is a directory with `preset.yml` (`name`, `description`, `order`) and `agent.cordis.yml`; every row runs in the preset's standing scope, so it reaches exactly the agents joined to that preset.
- Skill names are hyphenated (`asset-overview`), matching `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`; ark's underscore ids are renamed on migration. boat's skill metadata is the `metadata.boat` object of the SKILL.md frontmatter (`group`, `requiredTools`, `version`, `tags`).
- Tools are registered through `ctx.toolPolicy.register(definition, meta)` so visibility, confirmation, and the state delta are declared with the tool. `visibility: 'auto'` tools become visible only through an active skill's `requiredTools` or an explicit activation in `boat/pre-assemble`.
- Cards are rendered through `ctx.a2ui.render(...)` from the session state, returned on the tool result's presentation meta, and never described to the model beyond the digest.
- Business logic (`buildAssetsBundle`, thresholds, personas) lives in `agents/<id>/src` and is compiled to `agents/<id>/lib` so `./lib/x.js` rows resolve relative to the composition file. Deployment inputs (persona selection, template roots) are `Config` or environment read at the edge, documented in the preset's `package.json` description.
- Prompt orders: contexts `boat:state` 130, `boat:skill` 140; section `boat:skills` 450. New prompt text picks an order relative to these and to dsh's (`SANDBOX_POLICY` 110, `APPROVAL_POLICY` 115, `SUBAGENT_DELEGATION` 120) and records it in contracts.

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` (CI uses `--frozen-lockfile`) |
| Build | `pnpm run build` (`tsc -b`; emits every package's `lib/`) |
| Lint | `pnpm run lint` |
| Typecheck sources and tests | `pnpm run typecheck` |
| Unit tests (fast loop) | `pnpm run test:unit` |
| All tests (unit + e2e, builds first) | `pnpm run test` |
| Everything CI runs | `pnpm run check` |
| Driver equivalence smoke | `pnpm run smoke:equivalence` |
| Show one test's console output | `npx vitest run <file> --silent=false --reporter=verbose` |
| One-shot task | `node apps/cli/lib/bin.js run "task"` (needs `DEEPSEEK_API_KEY` or a scripted model via `DEEPSEEK_BASE_URL`) |
| boat driver + a plugin file | `node apps/cli/lib/bin.js run --driver boat --plugin examples/tools/plugin.mjs "查一下资产"` |
| A preset | `node apps/cli/lib/bin.js run --driver boat --agents ./agents --preset demo "看看资产"` |
| Imported history | `node apps/cli/lib/bin.js run --history examples/history/sa.json "继续刚才的话题"` |
| Browser UI | `node apps/cli/lib/bin.js web --no-open` |
| Composed plugin tree | `node apps/cli/lib/bin.js config dump --profile run` |
| Re-fork from the pinned dsh tag | `node --import tsx scripts/sync-upstream.ts <dsh checkout>` |

All boat data lives under `$BOAT_HOME` (default `~/.boat`); the launcher exports it as `DSH_HOME` before any dsh package loads, so a user's `~/.dsh` is never touched. Set `DSH_TELEMETRY_DISABLED=1` in tests and CI.
