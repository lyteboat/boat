# boat

boat is an agent harness built as Cordis plugins on top of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), and a distribution of dsh. It is the TypeScript successor of ark-agentic: ark's runtime facts (skill routing, tool visibility, A2UI cards, session state, external history) are re-expressed as plugins on dsh's seams. boat owns the source of dsh's core packages (the kernel, `dsh/`) under their published names, so every official package and community plugin binds to boat's implementation; it promises them the protocol, interfaces, and behavior of the release it tracks (`dsh.upstream.json`, `contract/COMPAT.md`). The design documents (the boat artifacts) own the roadmap and the acceptance logs; this file owns how to work in the repository.

Read [README.md](README.md) for what runs today and [contract/COMPAT.md](contract/COMPAT.md) before touching `dsh/`. When a dsh API is unclear, read the kernel's source under `dsh/` or, for other dsh packages, the tracked tag's checkout (`packages/<group>/<pkg>/src`) rather than guessing from the published `lib/`.

## Stack

TypeScript 6 (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), ESM only, Node ^22.19 || >=24 · pnpm 11 workspaces (`boat/*/*`, `dsh/*/*`; `overrides` route the kernel names to `dsh/`) · `tsc -b` with project references, then tsdown for the kernel bundles (upstream's own build) · vitest 4 (unit, composite, e2e, and upstream's kernel tests in one runner) · oxlint (`correctness` = error) · Cordis 4 IoC (`@deepseek-ai/cordis`) · dsh 0.1.7-alpha.2: the kernel from `dsh/`, every other dsh package from npm as a peer dependency · `@deepseek-ai/schemastery` for plugin `Config`, zod for projection state schemas.

## Repository layout

```
dsh/                      the kernel: dsh packages boat owns (dsh/kernel.json), published names kept
  core/session/ core/system-prompt/ core/tools/ core/agent/ core/agent-loop/
  session/session-projection/ session/session-persistence/ session/session-persistence-jsonl/
  compaction/compaction/ compaction/compaction-basic/ test-support/agent-loop-testkit/
                          each: upstream's src/ and tests/ as imported, boat's commits on top,
                          boat-owned modules in src/boat/ and tests/boat/
  kernel.json             the kernel list (promotion adds a row); tsdown.config.ts: upstream's root bundling options
boat/
  apps/cli/               @boat/cli — the `boat` launcher: profile templates, patch stack, boot (adapted from dsh's CLI)
  bundles/host/           @boat/host — the host bundle every profile lists: boat's service rows
  bundles/run/            @boat/run — the one-shot bundle behind `boat run` (cordis.patch.yml, startup flags, the runner)
  plugins/distro/         @boat/distro — the boatDistro marker: the kernel's dsh base and the extensions it carries
  plugins/tool-policy/    @boat/tool-policy — visibility always/auto + activation, confirmation, state deltas → boatState projection
  plugins/skill-router/   @boat/skill-router — skill load modes full/dynamic, ark's LLM router, boatActiveSkill projection
  plugins/a2ui/           @boat/a2ui — ark's A2UI template engine, the render_a2ui tool, boatCards projection
  plugins/history-import/ @boat/history-import — SA history → session seed of closed turns
  core/contracts/         @boat/contracts — boat's declarations over the dsh seams: tool/skill metadata, the kernel's boat/* events (re-exported), log nodes, projection keys, BoatDistro
  core/cordis-compat/     @boat/cordis-compat — runtime values for const enums the published cordis build erases
  agents/demo/            @boat/agent-demo — an agent directory: agent.cordis.yml, preset.yml (display name, optional), skills/, a2ui/, fixtures/, src/ → lib/
  tooling/testing/        @boat/testing — the test harness boat's packages use: mountDshTestServices + MockAdapter, session-log, scripted-model, process
contract/                 what boat promises: COMPAT.md, dsh-<version>/ snapshots (api, services, events, config, persistence), extensions.yml
conformance/              the proof: upstream-tests/ (G2 harness); G4–G6 suites
scripts/                  check-layers.ts, upstream-pins.spec.ts; dist/ (import, snapshot, G1, delta, overlay gates, bundling, trees)
dsh.upstream.json         the tracked dsh release; .pnpmfile.cjs pins every non-kernel dsh and cordis package to it
```

Under `boat/`, one directory per layer, and a package's layer is its directory. `boat/apps/*` owns a process — `boat/apps/cli` owns the `boat` bin and nothing else does; `boat/bundles/*` are compositions, a `cordis.patch.yml` a profile includes by name, with no bin of their own; `boat/plugins/*` are the capabilities on the dsh seams those compositions wire together; `boat/core/*` are declarations and the cordis shim; `boat/agents/*` are business agents; `boat/tooling/*` is test infrastructure no runtime package depends on. A new runnable mode (`boat web`, an SDK entry) is a new `boat/bundles/<name>`, not a second app and not a branch inside `@boat/run`.

Each boat package has `src/` (compiled to `lib/`, gitignored), `tests/`, its own `tsconfig.json` with `references` to every workspace package it imports (kernel packages included), an entry in the root `tsconfig.json`, and a package.json `exports` entry per public subpath (`@boat/x`, `@boat/x/agent`, …) whose first key is the `@boat/source` condition pointing at `src/*.ts`. `exports` is the only resolution table: `boat/tsconfig.base.json` sets `customConditions: ['@boat/source']` and `vitest.config.ts` sets the same resolve condition, so typecheck and tests read boat's `src`; Node, the built CLI (`boat/apps/cli/lib/bin.js`), and cordis compositions use the default conditions and load `lib/`. There is no `paths` table. Kernel packages keep upstream's layout and manifests (as npm publishes them): the root `tsconfig.base.json` holds upstream's compiler options, `tsc` emits `lib/types/`, and `scripts/dist/bundle-kernel.ts` bundles `lib/index.js` with tsdown; boat's packages and tests load the kernel's built `lib/`, so a kernel change needs `pnpm run build` before boat's unit tests see it.

## Architecture boundaries

Dependencies flow downward only:

```
apps/*                          ← processes: they select and boot compositions; they name bundles and rows, they import no plugin
bundles/*                       ← compositions: they wire, they do not implement behavior
agents/*                        ← business logic and agent compositions; may depend on any boat plugin
plugins/*                       ← boat plugins; depend on core + dsh seams; between plugins only `import type` (a service declaration)
core/contracts                  ← types, constants, declaration merging only; no runtime behavior
tooling/*                       ← tests only (devDependencies); depends on core + dsh
dsh/ (the kernel) + @deepseek-ai/dsh-* from npm
                                ← the seams: tools, skills, llm, sessions, sessionProjections, systemPrompt, approval, agents, presets;
                                  the kernel knows no boat package
```

`pnpm run lint` enforces the direction with `scripts/check-layers.ts` (runtime edges per layer, devDependency edges to `boat/tooling/*` and from `boat/agents/*` to `boat/bundles/*`, value imports between plugins, no `@boat/*` anywhere in the kernel) and the declarations with knip (every import a package's `src` or `tests` makes resolves through a dependency that package declares).

Hard rules:

- **contracts is the only shared declaration home.** A new event, log node, projection key, or metadata field is declared once in `@boat/contracts` (declaration merging onto dsh's `Events` / `SessionEventMap` / `SessionProjectionStateMap`). A plugin that needs another plugin's data reads it through a projection or a service `inject`, never through a shared module.
- **Plugins sit on dsh seams; they do not re-implement them.** Tools go through `ctx.tools`, skills through `ctx.skills`, model calls through `ctx.llm`, state through `ctx.sessionProjections`, prompt text through `ctx.systemPrompt`, confirmation through the approval seam. If a seam is missing, first check whether dsh already has one under a different name.
- **Outside the kernel first.** A new behavior is a boat plugin, a seam provider, or a boat-owned seam before it is a kernel change; the kernel takes only harness-level capabilities, never business vocabulary. A kernel change is a design decision: the design document says why it cannot live outside, and which change class it is.
- **The kernel changes only by classified commits.** Every commit that touches `dsh/<group>/<package>/` carries `Dist-Change: backport | fix | extend | redesign | compat | drop | build` and the trailer its class requires (`Dist-Upstream` for backport, `Dist-Tests` for fix and redesign, `Dist-Extension` for extend, `Dist-Exit` for compat and drop), plus `Dist-Contract` and `Dist-Exit` wherever the contract or an exit condition is involved (`pnpm run dist:delta -- --check`). Keep hooks in upstream files to a few lines and put boat's logic in `src/boat/` and its tests in `tests/boat/`; a smaller carried hunk is a cheaper sync.
- **The contract only grows, by registration.** G1 compares boat's build with `contract/dsh-<version>/`: a removed export, member, event, service, or config field fails; an added or widened one fails unless `contract/extensions.yml` registers it (with its tests and exit condition) and an `extend` commit names it. A plugin outside the repository that uses an extension injects `boatDistro`. Persistence (the session event vocabulary) is held the same way by the overlay `persistence` gate.
- **Upstream's tests are never edited.** `dsh/*/*/tests` outside `tests/boat/` are upstream's and run under G2 as imported; an environment difference is an adaptation in `conformance/upstream-tests` (listed in its README), a test that cannot run outside upstream is excluded there with a reason, and a behavior boat changes on purpose is a `redesign`/`extend` whose upstream tests still pass.
- **Promotion.** A dsh package from npm enters the kernel the first time boat must change its implementation (not configure it, not replace it with a provider): add it to `dsh/kernel.json` and the overrides, import the tag again, and it falls under G1–G3 from that commit.
- **Composition is data.** `boat/bundles/host/cordis.patch.yml` is the host composition every boat profile lists (boat's service rows, the distro marker first), `boat/bundles/run/cordis.patch.yml` adds the one-shot mode; `boat/agents/<id>/agent.cordis.yml` is the per-agent composition. Host rows publish services (`@boat/distro`, `@boat/tool-policy`, `@boat/skill-router`, `@boat/a2ui`, `@boat/history-import`); agent rows declare policy against them (`@boat/tool-policy/agent`, `@boat/skill-router/agent`, `@boat/a2ui/agent`, `./lib/x.js`). An agent row must never publish a service into the root realm.
- **Framework packages stay domain-neutral.** `boat/bundles/*`, `boat/plugins/*`, and `boat/core/*` know no business vocabulary; asset buckets, personas, and Chinese product copy live under `boat/agents/*`. Strings ported from ark for golden fidelity (error messages, digest formats) are allowed inside `a2ui` and say so in a comment.
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
- **Misconfiguration fails loud.** Unknown tool names in a policy, an unknown agent, a missing template directory, a malformed manifest, a `Config` that fails its schema: throw at load, or at the earliest point the referent can be resolved. Never silently skip a missing referent. Degradations the design accepts (router timeout keeps the current skill, an unavailable approval channel denies) are logged at `warn` and recorded in the session log where the model would otherwise see a different world.
- **No hardcoded tunables in plugins.** Anything a deployment would change (router timeout, history window, provider/model, template roots, validation strictness) is a validated `Config` field settable from `cordis.yml`. Protocol constants (prompt orders, event names, the ark router prompt, surface-id format) stay fixed constants with a name.
- **Limits**: functions ≤ 160 lines, nesting ≤ 3, inheritance depth ≤ 2 (`Service` subclasses only; prefer composition). Extract on the third repetition, not the first: a helper used by two packages moves to `contracts` only when it is a contract, otherwise it stays local.
- **Logging**: `this.ctx.logger` / `ctx.logger` from cordis, prefixed with the plugin name (`boat skill router: …`). `warn` for handled degradation, `error` only for aborted operations. No `console.*` in `boat/bundles/*`, `boat/plugins/*`, `boat/core/*`, or `boat/agents/*`; the CLI writes to stdout/stderr on purpose and says so. Never log credentials, full model requests, or user history.
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
2. **Design.** Add the step to the design document (C2 which packages, C3 which services / events / projections, C4 the types and the log nodes) before writing code. When the change touches a public event, a projection key, or the kernel (`dsh/`), stop and confirm with the user.
3. **Review the design** against this file's rules and dsh's AGENTS.md; fix the design, not the code, when a clean test cannot be written.
4. **Implement** with the tests from the [test table](#testing), then `pnpm run check`.
5. **Accept.** Run the milestone's acceptance on the built binary with the scripted model, record the result (what was run, what the log showed) in the design document's acceptance log, and only then commit.

### Task types

**Simple** (`bug` / `chore` / docs / config): fix it, add the regression test, run the gates the change can affect.

**Structural** (`feature` / `refactor` / a new plugin or agent): design top-down through the C4 layers before code: C1 system context (what boat, dsh, the model, and the client see) → C2 containers (launcher, run bundle, driver, plugins, agents, tests) → C3 components (services, events, projections, prompt sections and their orders) → C4 code (types in contracts, hunks, log nodes, event ordering). Confirm with the user when the change touches a public contract or crosses a layer boundary.

**Design deliverable** for a structural task: the design document is a self-contained HTML artifact (mermaid inlined, never a CDN), published through the artifact tool, and never committed under the repository. It must contain the C4 diagrams, the step-by-step flow (one driver step with intake, pre-assemble, routing, activation, assembly; one tool call with state delta and card), the changes-and-impact table, and the acceptance log.

### Scope of change

**Every changed line traces back to the task.** Smaller diff beats tidier diff.

- **Required**: remove imports, helpers, config fields, and events your change orphaned; keep `README.md`'s package table and status in step with the code in the same commit.
- **Allowed**: dead-code removal limited to files you already edit, provably unreferenced, not a public export.
- **Forbidden**: drive-by renames or reformatting, refactors of working code outside the task, unclassified edits under `dsh/<group>/<package>/`, edits to upstream's test files, lint fixes in untouched files, changes to `data/`, `.env*`, `.github/`, `dsh.upstream.json`, or `.pnpmfile.cjs` without an explicit instruction.

### Done criteria

Run only the gates the change can affect, and report only the commands you ran.

1. Touched `src/` or `tests/`? `pnpm run check` (lint + build + full vitest run: spec, composite, and e2e) passes. `pnpm run test:unit` is the fast loop while iterating.
2. Touched types or a `tsconfig.json`? `pnpm run typecheck` (sources and tests) introduces no new errors.
3. Tests for the new code match the [test table](#testing).
4. Touched anything a user runs (CLI flags, `cordis.patch.yml`, an agent)? Run it once from the built binary (`node boat/apps/cli/lib/bin.js …`) with the scripted model or a real key, and paste the command in the commit or PR.
5. Touched `dsh/`? `pnpm run test` runs G1 and G2; `pnpm run dist:delta -- --check` passes; `pnpm run dist:overlay <upstream checkout> persistence` passes when the change can reach a persisted type; the extension, if any, is in `contract/extensions.yml` and `pnpm run lint` regenerated nothing stale.
6. Diff is in scope; `README.md` and the design document are current.

## Testing

| Task type | Tests required |
|---|---|
| `feature` / new plugin | Unit: happy path + ≥1 boundary case through the runtime harness (`mountDshTestServices` + `MockAdapter` from `@boat/testing`). Composition: one `*.composite.ts` in the bundle (or agent) that wires it, booting the composition in process with the scripted model and asserting on the session log. A new process surface (a flag, a bin, a profile) also gets an `boat/apps/<app>/tests/*.e2e.ts` on the built binary. |
| port from ark | Golden fixtures generated by ark's Python code, compared with deep equality; each deliberate deviation is a named test. |
| `bug` | Regression test that fails before and passes after. |
| `refactor` | Existing tests pass before and after; no new tests unless behavior moved. |
| `chore` / docs | Skip; run the existing suite if a touched path could regress. |

Conventions:

- **Tests are type-checked, not only transpiled.** `tsc -b` covers `src/` only and vitest strips types, so `pnpm run typecheck` also runs `tsc -p tsconfig.tests.json`; CI runs it.
- **Tests describe behavior, not implementation.** Name them `test('<subject> <does what> when <condition>')`; assert on session-log nodes, projection state, the model request the scripted server recorded, or the tool result, never on private fields.
- **Mock the boundary, not the unit.** The model (`MockAdapter` in unit tests, the scripted DeepSeek Messages server in e2e), the filesystem for skills and templates (fixtures under `tests/fixtures`), the clock when ordering matters. Never mock a boat service to test another boat service; mount both.
- **Unit harness** (`@boat/testing`): `new Context()` + invariant registry + `mountDshTestServices(ctx)` + `ctx.plugin(AgentLoop, { agents: [] })` (`@deepseek-ai/dsh-agent-loop`, boat's kernel) + the boat services under test + `ctx.llm.registerAdapter(['mock'], adapter)`. Router requests are recognized by their system text, never by call order.
- **Kernel tests** (`dsh/*/*/tests/boat/`): boat's tests of a kernel change use only the kernel and upstream's own test helpers (`../mock-adapter.ts`, the testkit), never `@boat/*`; they run in the vitest project `dsh` with upstream's tests (G2), under upstream's invariant host.
- **Who tests what.** `boat/plugins/*` and `boat/core/*` test their own behavior (`*.spec.ts`, in process, from `src`); `boat/bundles/*` and `boat/agents/*` test their composition (`*.composite.ts`); `boat/apps/*` test only their process surface — flags, help, exit codes, profiles — plus one built-binary smoke per bundle or agent (`*.e2e.ts`). A test never reaches into another package's `tests/` or `src/` by relative path; shared helpers live in `@boat/testing`.
- **Composition** (`boat/bundles/*/tests`, `boat/agents/*/tests`): `bootComposition` (`@boat/testing/composition`) boots dsh-base plus the bundles under test in the test process, the way the launcher boots a profile, with the inner arguments on `ctx.cmdlineArgs`; `pluginFileRow` stands in for `--plugin`. The cordis loader loads `lib/`, so vitest runs these files in the `composite` project, which does not set the `@boat/source` condition; `pnpm run test` builds first.
- **E2E** (`boat/apps/*/tests`): `runBoat` / `startBoat` (bound to the app's `lib/bin.js` through `boatLauncher` from `@boat/testing/process`) spawn the built launcher under plain Node with `BOAT_HOME` in a temp directory.
- **Scripted model and logs**: `startScriptedModel` (`@boat/testing/scripted-model`) answers by purpose (loop / title / router) and records every request; `@boat/testing/session-log` reads the log. Tool order in a request is not registration order: sort before asserting.
- **Fixtures** belong to the package whose tests use them: agent directories and plugin files for the run composition under `boat/bundles/run/tests/fixtures`, `--plugin` files for the launcher under `boat/apps/cli/tests/fixtures/plugins`, templates under `boat/plugins/a2ui/tests/fixtures`, ark baselines under `tests/fixtures/baseline`. Fix the fixture, never the normalizer.
- One `test.skip` is acceptable only with a reason string; a skipped new test marks the step ⚠️ partial in the design document.

## Unattended runs

- Work only on the branch the task designates. Never push to `main` / `master` / `develop`; never force-push, rebase, or amend a pushed commit without explicit permission; a rewrite that is permitted uses `--force-with-lease`.
- If the designated branch's PR is already merged, restart the branch from `origin/master` and treat the work as a new change.
- One focused fix attempt on a failing new test. Still failing → mark ⚠️ partial, skip the test with a reason, and say so in the commit and the design document.
- State assumptions in the commit message and the PR description instead of guessing silently; never create a PR unless asked.
- Never modify `.github/`, `dsh.upstream.json`, `.pnpmfile.cjs`, `pnpm-workspace.yaml`, `.env*`, or anything under `dsh/` outside a classified commit without explicit instruction.
- Commit messages: `<milestone-step>: <package> — <what it delivers>` for milestone work (`M2-3: @boat/tool-policy — …`), conventional `fix:` / `chore:` / `docs:` otherwise, followed by a body that states what runs now and what was accepted. End with the attribution trailers the session provides.
- Never put a model identifier in a commit, PR, code comment, or file.

## Upstream sync (the distribution)

- `dsh.upstream.json` names the tracked dsh version, tag, commit, and the cordis versions (taken from the tag's `vendor/*/package.json`). The kernel comes from `dsh/`; every other dsh package comes from npm at that version: `.pnpmfile.cjs` rewrites their `@deepseek-ai/*` dependencies to it at install and leaves the kernel names to the overrides. `pnpm-workspace.yaml` hoists `@deepseek-ai/*` and `@boat/*` because agent directories and the composition tests resolve bare row names from the repository.
- **The upstream line.** Each tag's kernel is one import commit (`scripts/dist/import-upstream.ts <checkout at the tag>`): the tree holds only `dsh/<dir>/` (files byte for byte, the published `package.json`, `tsconfig.json` references limited to the kernel), the parent is the previous import (found by its `Dist-Import` trailer), and no branch carries it; the branch merges it. The next sync is a three-way merge: previous tag, new tag, boat's commits.
- **A sync, step by step** (target: one sync a week, crossing as many tags as there are): check out the new tag beside the repository; `pnpm run dist:snapshot <checkout>` writes `contract/dsh-<new>/` and prints the contract difference from the tracked release; `pnpm run dist:import <checkout>` writes the import commit, then `git merge --no-ff <commit>`; resolve conflicts in boat's hunks; bump `dsh.upstream.json`, the catalogs (replace removed packages with the successors dsh's own bundles compose; keep `boat/apps/cli`'s closure a superset of dsh's `apps/cli`), and `minimumReleaseAgeExclude` if the release is younger than a day; `pnpm install` (from a clean `node_modules`), `pnpm run check`; `pnpm run dist:overlay <checkout> persistence` and `… g3`; `pnpm run dist:delta` for the report. A carried commit upstream made redundant (a backport, an extension whose exit condition now holds) is dropped in the same sync.
- **Channels.** boat-next follows every sync; boat-stable is cut only from a dsh release candidate and then takes backports only (contract/COMPAT.md §7).
- Files elsewhere adapted from dsh keep the header `Adapted from deepseek-ai/deepseek-harness` and are listed by that header in `THIRD_PARTY_NOTICES.md`.
- dsh's public APIs are pre-stable: a sync may rename a seam. Update every boat consumer in the same sync; a `compat` change keeps an upstream removal alive only for community plugins the canaries show still use it, and only until its `Dist-Exit`.

## Agent design

Read `docs/agent_design_principles.md` in ark-agentic before designing, reviewing, or porting an agent; ark's principles still apply, only the mechanism changed. Prompt changes need eval data; without it they are a working hypothesis and the commit says so.

- Vocabulary: an **agent** is a business agent's definition, the directory `boat/agents/<id>`; `boat run` declares it to dsh's `dsh-agent-preset-registry`, which calls it a preset, so "preset" names only that mechanism. An **agent instance** is the runtime `Agent` dsh creates per session; one agent has many instances.
- An agent is a directory with `agent.cordis.yml` (required; its rows are the preset's `plugins`, read by `boat/bundles/run/src/agent-directory.ts`) and an optional `preset.yml` (`name`, `description`, `order`: display only). Every row runs in the agent's standing scope, so it reaches exactly the sessions of that agent. `boat run --agents <dir> --agent <id>` selects one (`--preset` is a deprecated alias).
- Skill names are hyphenated (`asset-overview`), matching `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`; ark's underscore ids are renamed on migration. boat's skill metadata is the `metadata.boat` object of the SKILL.md frontmatter (`group`, `requiredTools`, `version`, `tags`).
- Tools are registered through `ctx.toolPolicy.register(definition, meta)` so visibility, confirmation, and the state delta are declared with the tool. `visibility: 'auto'` tools become visible only through an active skill's `requiredTools` or an explicit activation in `boat/pre-assemble`.
- Cards are rendered through `ctx.a2ui.render(...)` from the session state, returned on the tool result's presentation meta, and never described to the model beyond the digest.
- Business logic (`buildAssetsBundle`, thresholds, personas) lives in `boat/agents/<id>/src` and is compiled to `boat/agents/<id>/lib` so `./lib/x.js` rows resolve relative to the composition file. Deployment inputs (persona selection, template roots) are `Config` or environment read at the edge, documented in the preset's `package.json` description.
- Prompt orders: contexts `boat:state` 130, `boat:skill` 140; section `boat:skills` 450. New prompt text picks an order relative to these and to dsh's (`SANDBOX_POLICY` 110, `APPROVAL_POLICY` 115, `SUBAGENT_DELEGATION` 120) and records it in contracts.

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` (CI uses `--frozen-lockfile`) |
| Build | `pnpm run build` (`tsc -b`; emits every package's `lib/`) |
| Lint | `pnpm run lint` |
| Typecheck sources and tests | `pnpm run typecheck` |
| Unit tests (fast loop, no build, no composite or e2e) | `pnpm run test:unit` |
| All tests (spec + composite + e2e, builds first) | `pnpm run test` |
| Everything CI runs | `pnpm run check` |
| Show one test's console output | `npx vitest run <file> --silent=false --reporter=verbose` |
| One-shot task | `node boat/apps/cli/lib/bin.js run "task"` (needs `DEEPSEEK_API_KEY` or a scripted model via `DEEPSEEK_BASE_URL`) |
| A plugin file | `node boat/apps/cli/lib/bin.js run --plugin ./my-plugin.mjs "task"` |
| An agent | `node boat/apps/cli/lib/bin.js run --agents ./boat/agents --agent demo "看看资产"` |
| Imported history | `node boat/apps/cli/lib/bin.js run --agents ./boat/agents --agent demo --history boat/agents/demo/fixtures/history/sa.json "继续刚才的话题"` |
| Browser UI | `node boat/apps/cli/lib/bin.js web --no-open` |
| Composed plugin tree | `node boat/apps/cli/lib/bin.js config dump --profile run` |
| G1 contract check (after a build) | `pnpm run contract:check` |
| Upstream's kernel tests only (G2) | `npx vitest run --project dsh` |
| What boat carries on top of the tag | `pnpm run dist:delta` (`-- --check` for the trailer discipline only) |
| Snapshot a tag's contract | `pnpm run dist:snapshot <dsh checkout at the tag>` |
| Import a tag's kernel (then `git merge`) | `pnpm run dist:import <dsh checkout at the tag>` |
| Persistence and G3 gates | `pnpm run dist:overlay <installed dsh checkout at the tracked tag> persistence` / `g3` |

All boat data lives under `$BOAT_HOME` (default `~/.boat`); the launcher exports it as `DSH_HOME` before any dsh package loads, so a user's `~/.dsh` is never touched. Set `DSH_TELEMETRY_DISABLED=1` in tests and CI.
