# Upstream

Forked from deepseek-ai/deepseek-harness at dsh-v0.1.7-alpha.2 (00102833dfaee1da9f48a3a8eae9d34005a75218), MIT:

- `src/` ← `packages/core/agent-loop/src`
- `tests/` ← `packages/core/agent-loop/tests`

Re-sync with `node --import tsx scripts/sync-upstream.ts <checkout>`; the identity rewrites (package names, the effect label, the `FiberState` const enum) are listed in that script. The script never touches the files listed under "boat-owned" below; everything else is overwritten and the divergence below is re-applied by hand from `git diff`.

## Why a fork

ark's intake gate (answer a step with a fixed reply and no model request) and its pre-assembly hook (skill routing whose result must shape this very step's system prompt and tool set) have no extension point in the official driver: `agent/pre-step` fires after the prompt is assembled, and a rejection there has already paid for the assembly and leaves the wrong log shape. Alternatives weighed and rejected: an `LlmAdapter` that answers intake replies through `agent/request` (upstream log shape, but a `request/header` churn and one assembly per reply), `agent/inbox/claimed` plus `system-prompt/assemble` (fire at the right point but cannot short-circuit the step), an upstream PR (timeline outside boat's control), and a runtime monkeypatch (fragile). The fork keeps the driver verbatim and adds the smallest hooks; `apps/cli/tests/driver-equivalence.e2e.ts` proves both drivers write identical logs for the same scripted model, and the upstream test suite runs unchanged against the fork. At dsh-v0.1.7-alpha.2 the official driver still dispatches `agent/pre-step` after `systemPrompt.assemble`, and its new serial `agent/created` runs once per agent creation rather than per step, so neither replaces a hunk.

## Divergence from upstream

`src/agent.ts`

- `preStep`: dispatches the `boat/intake` waterfall after the inbox claim (a `reply` ends pre-step) and the `boat/pre-assemble` waterfall before `systemPrompt.assemble`.
- `turn()`: the `reply` branch of `PreparedStep` runs `replyStep` inside an open step, keeps the sticky `max-tokens` outcome, and continues the turn when next-step input is queued.
- `replyStep` and `hasSystemNode`: the reply is logged as an empty system head (when none exists), the claimed user messages, and an assistant message with `source: { provider: 'boat', model: <plugin> }`; no boat-specific node.
- `step()`: `startsSeries` is also true while the session has no `request/header`, so an empty head left by a reply or a history seed is replaced on in-history routes too.
- `PreparedStep` gains the `reply` member; imports from `@boat/contracts` and `@deepseek-ai/dsh-llm` (`createSystemMessage`).

`tests/`

- `request-freeze.spec.ts`: upstream spies on the `deepFreeze` export with `vi.spyOn`, which cannot target a real ESM namespace; the module is replaced with `vi.mock` and the assertions use the mocked function.
- `settings.spec.ts`: imports `liveConfig` from `./support/live-config.ts` because upstream imports it from another package's tests (`packages/settings/settings/tests/live-config.ts`), which no published package ships.
- `system-prompt-admission.spec.ts`: imports `toPiContext` from `./support/pi-context.ts` because the published `dsh-llm-pi-ai` does not export it.

boat-owned (never overwritten by the sync script)

- `tests/boat-intake.spec.ts`: the intake gate, the pre-assembly hook, the in-history head placement.
- `tests/support/live-config.ts`: upstream's `liveConfig` helper, copied.
- `tests/support/pi-context.ts`: a stand-in for upstream's `toPiContext`.
- `tests/support/source-kinds.ts`: brings `@deepseek-ai/dsh-agent-instructions`'s `agent-instructions` message source into boat's test program, which upstream's one-program typecheck has and `loop.spec.ts` injects.

Never mount both drivers in one tree: the fork keeps upstream's companion names (`agent-loop-invariant`, the `turnBoundary` and `inbox` projections), and `bundles/host/cordis.patch.yml` swaps the row instead (`apps/cli/src/drivers.ts` swaps it back for `--driver dsh`).
