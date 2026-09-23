# 轻舟 boat

> **轻舟智能体底座 —— 赋能行业穿越 AI 万重山。**
> *Harness for business, built on DeepSeek Harness.*

轻舟是构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）之上的业务智能体底座。我们不做 coding agent，我们要做的是生产级就绪、开箱即用的业务 harness：让 AI 能干活、干得对、有迹可查。

## 愿景

大模型是发动机，不是收割机。发动机再强，不装上专用割台就不收粮食。

今天各行业面临的局面完全一样：模型能力已不是瓶颈，把模型接进真实业务、跑通最后一公里才是。最后一公里里没有新算法，只有一件件具体的事：模型在哪一步该看到哪些工具，哪些操作必须先经人确认，业务状态以谁为准，结果怎样以业务界面交到用户手里，出了问题怎样还原模型当时看到了什么。每个行业团队都要把这些重新做一遍。

轻舟把这最后一公里做成一套可复用的垂域智能体底座。行业团队只需装上自己的割台，也就是业务技能、业务工具和卡片模板，就能得到一个上得了生产的智能体。

### 发动机、底座、割台

| | 是什么 | 在轻舟里 |
|---|---|---|
| 发动机 | 大模型，提供通用智能 | 经 dsh 的模型接入层调用，底座不绑定某一个模型 |
| 底座 | 把模型变成可靠劳动力的运行时 | dsh 提供会话、工具、技能、审批、持久化与 Web UI；轻舟在 dsh 的扩展点上以插件补齐业务能力。底座领域中立，不含任何行业词汇 |
| 割台 | 某个行业专用的那一部分 | `agents/<id>` 一个目录：人设、业务技能、业务工具、卡片模板、业务逻辑。换行业就换割台，底座不动 |

### 能干活、干得对、有迹可查

**能干活。** 业务能力以目录交付，挂上底座即可运行。

- 技能路由：动态模式下，每轮用户输入先经一次旁路模型调用分派到对应业务技能，本轮请求只带该技能的说明和所需工具（`@boat/skill-router`）。
- 业务卡片：工具结果按模板渲染为 A2UI 卡片直接交给业务用户，模型只看到卡片摘要（`@boat/a2ui`）。
- 接续历史：业务系统里已有的对话记录可导入为会话的前序轮次，智能体从业务现场接着干（`@boat/history-import`）。

**干得对。** 让模型在规则之内工作，而不是靠提示词碰运气。

- 工具可见性：工具声明为常驻或按需，按需工具只在对应技能激活时对模型可见（`@boat/tool-policy`）。
- 操作确认：声明为需确认的工具先走 dsh 的审批通道，无人应答时默认拒绝。
- 业务状态：状态由工具结果携带的增量折叠进会话投影，以数据为准，不以模型记忆为准。
- 入口闸门：`boat/intake` 在模型调用之前运行，可以直接给出固定答复，越界请求不必交给模型。

**有迹可查。** 模型看到的一切，都能从会话日志还原。

- 卡片、状态增量、闸门答复与导入的历史都落在 dsh 已有的日志信封上，不另起格式。
- 技能路由的请求与决策记录为 `boat/route-request`、`boat/skill-routed`，每一次分派都有据可查。
- 事后复盘时，从日志即可重建模型当时收到的完整上下文。

### 为什么基于 DeepSeek Harness

- **不重造轮子。** 会话日志、工具与技能注册、审批、持久化、Web UI 由 dsh 提供，轻舟只做业务场景真正缺的那一层。
- **兼容生态。** 轻舟的每项能力都是 dsh 扩展点上的 Cordis 插件，dsh 社区的插件可以直接组合进来，轻舟的插件也能回馈社区。
- **升级可控。** 锁定一个 dsh 发布版本（`dsh.upstream.json`）；驱动 fork 只保留 `core/agentic-loop/UPSTREAM.md` 列出的改动，`--driver dsh` 随时切回官方驱动，两者对同一脚本化模型写出相同的会话日志。
- **经验延续。** 轻舟是 ark-agentic 的 TypeScript 继任者：ark 在业务场景中验证过的技能路由、工具可见性、A2UI 卡片、会话状态与外部历史，以插件形式在 dsh 上重新表达，并以 ark 的产出作为黄金基线校验。

### 开箱即用

一个业务智能体就是一个目录：

```text
agents/<id>/
  agent.cordis.yml   组合：人设、技能模式、工具与闸门
  preset.yml         展示名称（可选）
  skills/            业务技能，每个技能一个 SKILL.md
  a2ui/              卡片模板
  src/               业务逻辑：工具、状态、闸门
```

构建后一条命令即可运行随仓库提供的示例智能体 `agents/demo`：

```sh
pnpm install && pnpm run build
node apps/cli/lib/bin.js run --agents ./agents --agent demo "看看资产"
```

当前交付进度见下方 [Status](#status)。

## Vision (English)

> **Harness for business, built on DeepSeek Harness.**

The model is the engine, not the harvester: however strong the engine, it brings in no grain until a purpose-built header is mounted on it. Every industry faces the same situation today. Model capability is no longer the bottleneck; wiring the model into real business and closing the last mile is.

boat is not a coding agent. It is a production-ready, out-of-the-box harness for business agents, built as Cordis plugins on DeepSeek Harness (dsh). dsh supplies sessions, tools, skills, approval, persistence, and the web UI; boat adds what business work needs on dsh's seams (skill routing, tool visibility and confirmation, session state, A2UI cards, imported history) and stays domain-neutral; each industry mounts its own header as an agent directory under `agents/`. The goal is AI that gets the work done, does it right, and leaves a trace: everything a model sees is reconstructable from the session log.

The design document tracks the plan; this repository is its implementation, delivered one runnable milestone at a time.

## Status

- M0 — runnable skeleton: `boat run` and `boat web` boot the official dsh bundles through boat's own launcher.
- M1 — `@boat/agentic-loop`, a fork of dsh-agent-loop, the default driver since the layering refactor (`--driver dsh` mounts dsh's official one); both drivers write identical session logs for the same scripted model.
- M2 — boat's own plugins, one runnable step at a time. Step 1: `@boat/contracts` and the boat driver's intake path (`boat/intake`, `boat/pre-assemble`), plus `--plugin <file>`. Step 2: `@boat/run`, boat's one-shot runner, composing the agent from a preset directory (`boat run --agents ./agents --agent <id> "task"`). Step 3: `@boat/tool-policy`, tool visibility (`always`/`auto` + activation), confirmation through the approval seam, and tool-result state deltas folded into the `boatState` projection (`bundles/run/tests/tool-policy.composite.ts`). Step 4: `@boat/skill-router`, ark's skill load modes over the dsh skill registry: `full` puts every skill body in the system prompt, `dynamic` routes each user input through a side model call (ark's router prompt, sticky on null and errors), puts the active skill's body and required tools into the same step, and records `boat/route-request` / `boat/skill-routed`. Step 5: `@boat/a2ui`, ark's A2UI template engine ported field-for-field (manifest resolution, transforms DSL, walker, contract validation, checked against payloads ark produced for the same templates), the `render_a2ui` tool that renders a card from the session state and puts it on the tool result's meta, and the `boatCards` projection (`bundles/run/tests/a2ui.composite.ts`). Step 6: `@boat/history-import`, external conversation history (ark's SA history rules: rounds by trace id, half and malformed rounds dropped, ordered by create time) turned into a session seed of closed turns, so the task becomes the next turn and the first request already derives the imported rounds (`boat run --history <file>`, either driver). Step 7: `agents/demo`, the demo agent preset (persona, two routed skills, an asset tool that fills the state and renders the card in one call, a diagnosis tool, an intake gate), and the M2 integration acceptance over it (`boat run --agents ./agents --agent demo "看看资产"`).

## Requirements

- Node 22.19+ (or 24)
- pnpm 11.7 (`corepack enable` picks the pinned version up from `package.json`)

## Commands

```sh
pnpm install
pnpm run build
node apps/cli/lib/bin.js run "summarize this workspace"   # one-shot task
node apps/cli/lib/bin.js web --no-open                    # browser UI
node apps/cli/lib/bin.js config dump --profile run        # composed plugin tree
node apps/cli/lib/bin.js run --agents ./agents --agent demo "看看资产"
                                                          # the demo agent: routed skill, asset tool, card
pnpm run check                                            # lint + build + tests
```

Every boat profile lists `@boat/host`, which mounts `@boat/agentic-loop` in place of dsh's agent-loop and publishes boat's host services, so `boat run` and `boat web` both carry them; `--driver dsh` swaps the official driver back in. `--plugin <file>` inserts a local ESM plugin file as a row of the tree (the file's own imports resolve from its directory, so it works for files inside this checkout). Under the boat driver two extra waterfall events run after the inbox claim and before prompt assembly: `boat/intake` (answer the step with a fixed reply and no model request) and `boat/pre-assemble` (route skills and activate tools for this very step).

Model access uses dsh's own settings: `DEEPSEEK_API_KEY` (and optionally `DEEPSEEK_BASE_URL`) in the environment or in `$BOAT_HOME/.env`. All boat data lives under `$BOAT_HOME` (default `~/.boat`); the launcher exports that directory as `DSH_HOME` to the dsh packages before any of them load, so a user's own `~/.dsh` is never touched.

## Session logs

Everything boat records rides an envelope dsh already knows: a card and a state delta sit on `tool/result.meta.boat`, an intake reply is an assistant message whose `source` is `{ provider: 'boat', model: <plugin> }`, and imported history is closed turns of ordinary nodes. Those sessions reopen under dsh's own persistence (`bundles/run/tests/reopen.composite.ts` proves it). The skill router's `boat/skill-routed` and `boat/route-request` have no dsh envelope yet, so a session that routed a skill is refused by dsh's persistence until dsh offers a write path for the envelope's `ignorable` mark; the same test pins that limitation.

## Layout

One top-level directory per layer; dependencies point down only (`apps` → `bundles` → `plugins` → `core`; `agents` → `plugins`, `core`; `tooling` is for tests), and `pnpm run lint` checks it.

| Path | Package | Role |
|---|---|---|
| `apps/cli` | `@boat/cli` | the `boat` launcher: profile templates, patch stack, boot (adapted from dsh's CLI) |
| `bundles/host` | `@boat/host` | the host bundle every boat profile lists: the boat driver in place of dsh's agent-loop, and the tool-policy, skill-router, a2ui, and history-import service rows |
| `bundles/run` | `@boat/run` | the one-shot bundle behind `boat run`: task, `--agent` (alias `--preset`), `--agents`, `--history` |
| `plugins/tool-policy` | `@boat/tool-policy` | tool visibility, confirmation, and state deltas over the dsh tool registry; `./agent` declares policy from an agent's composition file |
| `plugins/skill-router` | `@boat/skill-router` | skill load modes and LLM routing over the dsh skill registry; `./agent` declares the mode from an agent's composition file |
| `plugins/a2ui` | `@boat/a2ui` | the A2UI template engine (ark's template mode), `render_a2ui`, and the `boatCards` projection; `./agent` composes the tool from an agent's composition file |
| `plugins/history-import` | `@boat/history-import` | SA history parsing and the session seed behind `boat run --history` |
| `core/contracts` | `@boat/contracts` | boat's contract extensions over the dsh seams: tool and skill metadata, `boat/*` events, log nodes |
| `core/cordis-compat` | `@boat/cordis-compat` | runtime values for const enums the published cordis build erases |
| `core/agentic-loop` | `@boat/agentic-loop` | the boat agent driver (fork of dsh-agent-loop, see `core/agentic-loop/UPSTREAM.md`) |
| `agents/demo` | `@boat/agent-demo` | the demo agent: `agent.cordis.yml`, `preset.yml` (display name), `skills/`, `a2ui/`, `fixtures/` (personas, a sample SA history), `src/` compiled to `lib/` |
| `tooling/testing` | `@boat/testing` | boat's test harness: dsh service mounting and `MockAdapter`, the session-log reader, the scripted model, launcher spawning |
| `tooling/dsh-agent-loop-testkit-fork` | `@boat/dsh-agent-loop-testkit-fork` | verbatim fork of agent-loop-testkit, used only by the driver's synced upstream tests |
| `scripts/` | — | `sync-upstream.ts` (re-fork from the pinned dsh tag), `check-layers.ts` |
| `dsh.upstream.json` | — | the pinned dsh release; `.pnpmfile.cjs` pins every dsh and cordis package to it |

## Why the pnpm settings look unusual

- `publicHoistPattern: ['@deepseek-ai/*']` — dsh's launcher links the installation closure into `$DSH_HOME/profiles/node_modules` by walking `require.resolve.paths()` from each package's symlink path; under pnpm's isolated layout that walk only reaches the launcher's direct dependencies.
- `.pnpmfile.cjs` — published dsh packages depend on each other with caret ranges, so an unpinned install drifts to a newer prerelease than the tag boat was developed against.
- `allowBuilds` — pnpm 11 blocks install scripts unless listed; only the node-pty helper chmod is needed on Linux/macOS.
