# Changelog

lyteboat has no releases. The tracked dsh release is in `dsh.upstream.json`.

## Unreleased

lyteboat is an agent harness for business agents, built as Cordis plugins on DeepSeek Harness (dsh) 0.1.7-rc.2, and a distribution of dsh: it owns the source of dsh's kernel packages under their published names and promises plugins written against dsh the protocol, interfaces, and behavior of that release (`dsh-compat/COMPAT.md`).

### Kernel

- 14 dsh packages under `dsh/` (`dsh/kernel.json`: `dsh-llm`, `dsh-session`, `dsh-system-prompt`, `dsh-tools`, `dsh-skill`, `dsh-agent`, `dsh-agent-loop`, `dsh-session-projection`, `dsh-session-persistence`, `dsh-session-persistence-jsonl`, `dsh-compaction`, `dsh-compaction-basic`, `dsh-agent-loop-testkit`, `dsh-api-session-controller`), imported from dsh-v0.1.7-rc.2 and resolved by name for the whole dependency graph; their bundles build byte for byte as npm publishes them. Every other dsh package is installed from npm at the tracked version.
- Four registered extensions (`dsh-compat/contract/extensions.yml`), listed at runtime by the `lyteboatDistro` service:
  - `agent-loop-intake`: the `lyteboat/intake` waterfall, after the inbox claim and before prompt assembly; a `reply` answers the claimed messages with an assistant message (source provider `lyteboat`) and no model request.
  - `agent-loop-pre-assemble`: the `lyteboat/pre-assemble` waterfall, before the system prompt is assembled, so skill routing and tool activation shape the same step's request.
  - `session-append-ignorable`: `Session.append(type, data, { ignorable: true })` marks an informational record of a type dsh does not know, so dsh's persistence and the official release read a log past it.
  - `session-controller-prompt-source`: `SessionPromptRequest.sourceFields` adds a caller's fields to the source of the user message a session-controller `prompt` appends, beside `kind`, `rpcId`, and `clientTimeZone`, which it refuses to overwrite.
- The kernel behaves as the official release does, including its request series: a tool-set change between requests appends a `developer/message` from the `tool-registry` source, and on a route that declares `toolUpdate` (dsh's default `deepseek-flash` is `addition-only`) the change continues the series instead of starting a new one.

### Plugins

- `@lyteboat/distro`: the `lyteboatDistro` marker service, naming the dsh release the kernel comes from and the extensions this build carries. A plugin that uses an extension injects it, so it stays unloaded on the official release.
- `@lyteboat/tool-policy`: tool visibility (`always` / `auto`, with activation by a skill or in `lyteboat/pre-assemble`), confirmation through the approval seam, and tool-result state deltas folded into the `lyteboatState` projection. The agent row `@lyteboat/tool-policy/agent` declares policy for tools other rows register, and `undeclared: always | auto` for the inherited tools it does not name.
- `@lyteboat/aux-llm`: side model calls (a router's, an intake classifier's), each under its own deadline and recorded as an ignorable `lyteboat/aux-llm-call` (route, system, prompt, answer or failure, duration); an answer cut off at `maxTokens` is a failure. `reasoningEffort` sets the effort every side call requests.
- `@lyteboat/request-context`: the request a human message answers to (request id, owner, trace id, context, admission verdict) rides the message's own source (`source.lyteboatRequest`); the `lyteboatRequest` projection keeps the session's context until a request brings another. Tools read it; the model never sees it.
- `@lyteboat/intake-guard`: admission ahead of the loop. An agent registers an admission function; a caller submits each request through `intakeGuard.submit(agent, { text, context?, requestId? }, signal)`, which admits it and follows it up with the verdict recorded on the request. A reply verdict (text and cards) answers the turn without a model request; a message that arrives unadmitted is admitted in the loop.
- `@lyteboat/skill-router`: skill load modes over the dsh skill registry. `full` puts every skill body in the system prompt; `dynamic` routes each user input through a side call (the reference router prompt, sticky on null, errors, and timeouts; `historyWindow`, `timeoutMs`, and `maxTokens` (default 200) configurable, with an optional route of its own), activates the chosen skill's `requiredTools`, and enters its body as dsh's own skill-invocation message, so a routed session reopens and continues. The agent row `@lyteboat/skill-router/agent` sets the mode per agent.
- `@lyteboat/a2ui`: the reference A2UI template engine (manifest resolution, transforms DSL, walker, contract validation against a domain-neutral default component catalog), the `render_a2ui` tool (`@lyteboat/a2ui/agent`), `renderCard`, `cardsPresentationMeta`, and `cardMarker` for an agent's own tools, the `lyteboatCards` projection, and `turnParts`, which lays out a finished turn: cards by emission mode (`immediate`, `deferred`, `deferred_discard`) and the answer's `[[card:<area>]]` markers. A card with an unknown `emission_mode`, a malformed manifest, or a `compute.js` that exports only its default fails at load.
- `@lyteboat/agent-catalog`: scans agent roots (a subdirectory with `agent.cordis.yml` is an agent, its kebab-case name the id), declares each to dsh's preset registry with the directory as base URL once the host tree has settled, and reports the agents that fail to read or mount; `whenReady()` rejects in strict mode (the default), `list()`, `get(id)`, `failures()` report. Two roots holding one id, or an included id no root holds, fail.
- `@lyteboat/history-import`: external conversation history (entries grouped into rounds by trace id, half rounds dropped, ordered by create time) turned into a session seed of closed turns.
- `@lyteboat/contracts`: lyteboat's declarations over the dsh seams: tool and skill metadata (`LyteboatToolMeta`; `LyteboatSkillMeta` with `requiredTools` only), the kernel's `lyteboat/*` events (re-exported), the `lyteboat/aux-llm-call` record, the projection keys, the prompt orders `LYTEBOAT_STATE_CONTEXT_ORDER` (130) and `LYTEBOAT_SKILLS_SECTION_ORDER` (450), `LyteboatDistro`, and the zod schemas of the JSON envelopes it declares. The projections that fold a lyteboat envelope (`lyteboatState`, `lyteboatCards`, `lyteboatRequest`) throw on a malformed one.

### Bundles and the launcher

- `@lyteboat/host`: the host bundle every profile lists, with lyteboat's service rows over dsh-base; it turns off dsh-base's `session-log-deepseek` and `session-telemetry-otel` rows, so the model provider receives the request only and no session leaves the machine.
- `@lyteboat/headless`: the one-shot bundle behind `lyteboat headless` (renamed from `run`, as dsh names its own one-shot mode): it composes the selected agent, which `@lyteboat/agent-catalog` declares from its `--agents` root, resumes a stored session under the agent it ran with, or seeds a new session from imported history; then it submits the task with its request context, drives it to quiescence, prints the answer with its cards placed (`[card <area>]` lines) to stdout and the session id to stderr, and exits.
- `@lyteboat/cli`, the `lyteboat` launcher (adapted from dsh's CLI): profile templates `headless` (dsh-base, host, headless) and `web` (dsh-base, host, dsh-web-app) under `$LYTEBOAT_HOME` (default `~/.lyteboat`, exported as `DSH_HOME` before any dsh package loads); a profile whose template bundle is skipped fails the boot.
  - `lyteboat headless [options] "task"`: `--agents <dir>` (repeatable), `--agent <id>`, `--history <file>`, `--session-id <id>`, `--context <json|file>`.
  - `lyteboat web [options]`: the browser UI; the web app's own flags follow.
  - `lyteboat config dump [options]`: the composed plugin tree; `--default` prints the bundle layers only.
  - All three take `--profile <name>`, `--patch <path>` (repeatable), and `--plugin <file>` (repeatable).

### Example agent

- `@lyteboat/agent-finance` (`examples/agents/finance`): an agent kept deliberately minimal, built from public financial knowledge only. Three routed skills and three tools: an asset overview (one card), an allocation diagnosis by the 100-minus-age rule (two cards the answer places by markers), investor education on three concepts. The request context names the customer; its admission classifies each request with a side call before the loop (investor education and small talk pass, a request about the customer's money needs a known customer with an authorized account and otherwise gets a reply, the unauthorized card included, anything else gets the service scope; a failed classification lets the request through). Its composition hides every inherited tool except `skill` (`undeclared: auto`).

### Testing

- `@lyteboat/testing`: `createLyteboatUnitHost` (dsh's invariants, the dsh services, the kernel's agent loop, a scripted adapter), `MockAdapter`, and `followUpAndWait` for unit tests; `/composition` (`bootComposition`, `LYTEBOAT_HEADLESS_BUNDLES`, `pluginFileRow`, `printedSessionId`) boots a composition in the test process; `/scratch` (`createLyteboatScratch`) gives each run its own home and workspace; `/scripted-model` (`startScriptedModel`, `scriptedModelEnv`) is a DeepSeek Messages server that answers by purpose and records every request; `/session-log` reads and normalizes session logs; `/session-reopen` (`reopenRefusal`) runs a log through dsh's reopen check; `/process` spawns the built launcher.

### Compatibility gates

- G1: lyteboat's kernel build has the contract of dsh 0.1.7-rc.2 (`dsh-compat/contract/dsh-0.1.7-rc.2/`); every difference is a registered extension. Runs in `pnpm run test`.
- G2: upstream's own kernel tests pass unmodified on lyteboat's sources (`dsh-compat/tests/upstream-harness` lists the adaptations and exclusions). Runs in `pnpm run test`.
- G3, persistence, typert: upstream's cross-package tests, its durable-record schema, and its Typert generator, run against lyteboat's kernel in an upstream checkout (`pnpm run dist:overlay`).
- G4: the official release and lyteboat write the same session log for the same scripted run, including a tool set that changes mid-session on an addition-only route and on a route without tool updates.
- G5: 23 pinned community plugins install with `dsh plugin add`, run the same on both, and bind to lyteboat's kernel.
- G6: a session either side writes, the other reopens and continues.
- G4–G6 run with `pnpm run dsh-compat`; `pnpm run dist:delta -- --check` holds the classified-commit discipline for every change under `dsh/`; `pnpm run lint` runs oxlint, knip (declarations and dead exports), the layer check, the distro manifest check, and the sensitive-word check.
