# boat 架构：从启动到一次请求

> **读者**：熟悉 ark-agentic（boat 的 Python 前身）、刚接触 dsh（DeepSeek Harness）的工程师。
>
> **描述的状态**：仓库 `3d29a07`（`dist(promote): dsh-llm and dsh-skill enter the kernel`），跟踪 dsh `0.1.7-rc.1`（`dsh.upstream.json`，tag `dsh-v0.1.7-rc.1`，commit `46a7f68b`），内核 13 个包（`dsh/kernel.json`）。发行版蓝图 v7 写作时内核还是 11 个包，`3d29a07` 把 `dsh-llm`、`dsh-skill` 提进来后是 13 个（蓝图 v8 已跟上），本文以仓库为准。
>
> **路径约定**：不带前缀的路径相对仓库根目录；`dsh@rc.1:` 前缀指上游 tag `dsh-v0.1.7-rc.1` 的源码（`packages/<group>/<pkg>/src`、`vendor/*`），也就是 boat 从 npm 安装、没有接管的那些包的源码。`file:行号` 都对照过当前代码。
>
> **例子怎么来的**：文中的运行结果（stdout、stderr、会话日志、模型收到的请求）都来自构建好的 CLI `node boat/apps/cli/lib/bin.js`，模型是 `@boat/testing` 的脚本化模型（`boat/tooling/testing/src/scripted-model.ts`），`DSH_TELEMETRY_DISABLED=1`，没有用真实 key。[5.4](#54-日志怎么映射回模型看到的内容) 的请求重建和 [5.6](#56-为什么路由过的会话不能重开) 的重开检查是对这些日志的**离线分析**，用的是内核自己的 `Session.create` 和 `validateStoredEvents`。日志里的模型标识一律写成 `<model>`。
>
> **命令的写法**：为了好读，正文里的命令写成从仓库根目录跑、`--agents ./boat/agents`。样本日志实际是在一个单独的临时 workspace 目录里跑的，`--agents` 给的是绝对路径（header 里的 `cwd` 显示为 `.../workspace`），所以 sessions 下的目录名、header 的 `cwd`、系统提示长度（含 cwd）和你从仓库根跑出来的会不一样。[7.5](#75-复现本文的运行) 给出了能照抄运行的脚本。

---

## 0. 一页纸总结

### 0.1 一句话

**boat 是 dsh 的一个发行版：它拥有 dsh 内核 13 个包的源码（沿用上游包名），把 ark-agentic 的运行时能力（skill 路由、工具可见性、A2UI 卡片、会话状态、外部历史导入）写成挂在 dsh 接缝上的 Cordis 插件，再用自己的启动器 `boat` 把这些东西按 YAML 组合起来跑。**（`CLAUDE.md:3`）

为什么要“拥有内核源码、保留包名”：npm 上的官方包和社区插件都按包名 `@deepseek-ai/dsh-tools` 这类名字去 import 内核；boat 用 pnpm `overrides` 把这些名字全部指到 `dsh/` 下自己的副本（`pnpm-workspace.yaml:16-29`），于是整个依赖图里只有一份内核，而且是 boat 的。插件不用改一行代码就跑在 boat 的实现上。

### 0.2 三层包

| 层 | 在哪 | 有哪些 | 源码归谁 | 怎么改 |
|---|---|---|---|---|
| 内核 | `dsh/`（清单 `dsh/kernel.json:3-17`） | `dsh-llm`、`dsh-session`、`dsh-system-prompt`、`dsh-tools`、`dsh-skill`、`dsh-agent`、`dsh-agent-loop`、`dsh-session-projection`、`dsh-session-persistence`、`dsh-session-persistence-jsonl`、`dsh-compaction`、`dsh-compaction-basic`、`dsh-agent-loop-testkit` | boat（每个上游 tag 原样导入，再叠 boat 的分类提交） | 只能用带 `Dist-Change:` trailer 的提交（`CLAUDE.md:70`） |
| 其余 dsh 包 | `node_modules`，从 npm 装 | `dsh-base`（bundle）、`dsh-app-boot`、`dsh-agent-preset-registry`、`dsh-llm-deepseek`、`dsh-user-approval`、`dsh-session-checkpoint-policy` 等 | 上游 | 不改源码，只用 patch 层改配置、增删行；版本被 `.pnpmfile.cjs:7-22` 钉在 `0.1.7-rc.1` |
| boat 自己的包 | `boat/<层>/<包>` | `@boat/cli`、`@boat/host`、`@boat/run`、`@boat/distro`、`@boat/tool-policy`、`@boat/skill-router`、`@boat/a2ui`、`@boat/history-import`、`@boat/contracts`、`@boat/cordis-compat`、`@boat/agent-demo`、`@boat/testing` | boat | 正常开发，层间只能向下依赖（`CLAUDE.md:49-61`） |

为什么 `dsh-llm` 和 `dsh-skill` 在内核里：内核的准入规则是“boat 必须改它的实现”，或“它是每个 boat 组合启动都离不开的能力”（`CLAUDE.md:73`）。模型访问、工具、skill、会话是每个 boat 组合都依赖的能力，`dsh-llm` 和 `dsh-skill` 就是按后一条进来的（提交 `3d29a07`）。但要分清“依赖”和“启动审计强制”：启动审计真正强制的只有 `agent-loop` 注入的服务（`llm`、`tools`、`sessions`、`systemPrompt`、`sessionProjections`、`agents`，`dsh/core/agent-loop/src/index.ts:334`），禁掉 `llm` 行会 `StartupError` 并退出 1；`skill` 行缺失时 `boat run "你好"` 仍能启动，只警告 3 行 pending，而带 `--agent demo` 时 demo 的 preset 会因为 `demo-tools` 等不到 `skills` 而失效、退出 1。完整实验见 [3.4](#34-启动保证哪些能力)。

### 0.3 一次请求经过哪些部件

以 `boat run --agents ./boat/agents --agent demo "看看资产"` 为例：

1. **启动器** `@boat/cli` 把 profile `run` 组合成一棵 Cordis 插件树（dsh-base → `@boat/host` → `@boat/run`，共 100 行），启动完根 realm 里有 65 个服务。
2. **`@boat/run`** 把 `boat/agents/demo` 声明成一个 preset，通过内核的 `agents.create` 建出一个 agent 实例，把任务 `followup` 进去。
3. **内核 driver**（`ReactLoopAgent`）跑一个 turn：inbox → `boat/intake`（demo 的拒识门放行）→ `boat/pre-assemble`（skill-router 用一次旁路模型调用选中 `asset-overview`，tool-policy 让 `asset_overview` 可见）→ `systemPrompt.assemble` → `agent/pre-step` → `llm.stream`。
4. 模型调用 `asset_overview`：tools 运行时走 `tools/pre-execute` → `tools/execute` → `tools/post-execute`，工具的 `presentationMeta` 产出 `meta.boat.{card,stateDelta}`，写进 `tool/result`。
5. **投影**把 `tool/result` 折叠成 `boatState`、`boatCards`；下一个 step 的 runtime context 里就出现了 `boat:state`，模型据此回答。
6. 每条事件都经 `Session.append` 进入会话日志，由 JSONL 后端写到 `$BOAT_HOME/sessions/.../session.v4.jsonl.zstd`。

### 0.4 给 ark-agentic 工程师的对照

| ark-agentic | boat / dsh | 差别在哪 |
|---|---|---|
| `Lifecycle` Protocol：`init` / `install_routes` / `start` / `stop`（ark-agentic `src/ark_agentic/core/protocol/lifecycle.py:9-31`） | Cordis 插件：`apply(ctx, config)` 或 `Service` 子类；停止靠 `ctx.effect` 登记的 disposer | 没有显式的 start 阶段：插件声明 `inject`，依赖的服务到齐就激活，依赖消失就卸载 |
| `Bootstrap(plugins=[...])`（ark-agentic `src/ark_agentic/core/protocol/bootstrap.py:21`） | `boot()`（`dsh@rc.1:packages/boot/app-boot/src/index.ts:970`）+ profile 的 patch 层 | 组合写在 YAML 里（`cordis.patch.yml`），不是 Python 列表；用户可以用 `--patch` 覆盖任意一行 |
| `AppContext` | Cordis `Context` 上的服务：`ctx.llm`、`ctx.tools`、`ctx.sessions`… | 按名字发布、按名字注入 |
| `BaseAgent.build_tools()` / `build_llm()` / `build_skill_router()`（ark-agentic `src/ark_agentic/core/runtime/base_agent.py:187-258`） | agent 目录的 `agent.cordis.yml`，每行一个插件（`boat/agents/demo/agent.cordis.yml:5-24`） | 行在 agent 的 standing scope 里运行，只影响这个 agent 的会话 |
| Runner + `RunnerCallbacks` | 内核 `AgentLoop` / `ReactLoopAgent` + 事件（`boat/intake`、`boat/pre-assemble`、`tools/*`…） | 回调变成 waterfall 事件，谁都可以挂 |
| SessionManager + JSONL | `sessions`（dsh-session）+ `sessionPersistence`（dsh-session-persistence-jsonl，zstd 分帧） | 日志是唯一事实来源，模型请求由日志推导出来 |
| SkillRouter（`BaseAgent.build_skill_router()`，ark-agentic `base_agent.py:213`） | `@boat/skill-router` | ark 的路由 prompt 原样移植（`boat/plugins/skill-router/src/router.ts`） |
| `BaseAgent.build_compaction()`（ark-agentic `base_agent.py:210`） | 内核包 `dsh-compaction` + `dsh-compaction-basic`，后者作为 `agent/pre-step` 监听运行（`dsh/compaction/compaction-basic/src/index.ts:158`） | 压缩不是 Runner 的一个配置项，而是 step 进入前的一层 waterfall；压缩过程写成 `compaction/start` / `compaction/summary` / `compaction/end` 进日志（`dsh/compaction/compaction-basic/src/region.ts:210,237,491`） |
| Runner 里的重试 | npm `dsh-llm-retry`，监听 `agent/request-error`（`dsh@rc.1:packages/llm/llm-retry/src/index.ts:243`） | 失败的请求在日志里留一条 `assistant/attempt`，重试决定由插件给出 |
| `SessionHistoryMerger`（`base_agent.py:222`） | `@boat/history-import` + dsh 的 session seed | 外部历史变成会话开头的“已关闭的 turn”，见 [5.7](#57-外部历史导入种子怎么进日志) |
| memory：`MemoryProvider` Protocol（ark-agentic `src/ark_agentic/core/protocol/memory_provider.py:21-`）+ `MemoryWriteTool`（`src/ark_agentic/core/tools/memory.py:40`，由 `create_memory_tools` 在 117 行创建） | dsh `0.1.7-rc.1` 的 `packages/` 下没有 memory 分组，run 组合里也没有对应服务。最接近的机制：`dsh-agent-instructions` 在 `agent/pre-step` 把 AGENTS.md 类文件注入上下文（`dsh@rc.1:packages/context/agent-instructions/src/index.ts:315`，在 run 组合里）；`dsh-session-reference` 做跨会话引用（`dsh@rc.1:packages/context/session-reference/src/index.ts:1-5`，只由 web 组合的 `dsh@rc.1:packages/bundle/web-app/cordis.patch.yml:75-76` 挂上） | 没有“长期记忆读写”这一层，需要单独设计 |

---

## 1. C4 结构，逐层递进

### 1.1 C1 系统上下文

```mermaid
flowchart TB
  user["终端用户<br/>boat run / boat web"]
  dev["业务开发<br/>写 agent 目录、插件、patch"]
  author["社区插件作者<br/>按 dsh 公开接口写插件"]
  subgraph SYS["本系统"]
    boat["boat<br/>dsh 发行版 + ark 能力插件<br/>启动器 boat/apps/cli"]
  end
  upstream["dsh 上游<br/>deepseek-harness tag dsh-v0.1.7-rc.1"]
  npm["npm 上的官方 dsh 包<br/>@deepseek-ai/dsh-* 0.1.7-rc.1"]
  cplug["社区插件<br/>npm 包或本地 .mjs 文件"]
  model["模型服务<br/>DeepSeek Messages API 兼容端点"]
  user -->|"命令行 / 浏览器"| boat
  dev -->|"agent.cordis.yml、--plugin、--patch"| boat
  upstream -->|"每个 tag 导入内核源码 dist:import"| boat
  npm -->|"安装时钉版本，运行时按行加载"| boat
  author -->|"发布"| cplug
  cplug -->|"import 内核包名，绑定到 boat 的实现"| boat
  boat -->|"HTTPS POST .../messages"| model
```

| 外部元素 | 是什么 | 和 boat 的关系 | 依据 |
|---|---|---|---|
| 终端用户 | 跑 `boat run "任务"` 或 `boat web` 的人 | 通过命令行参数和浏览器交互 | `boat/apps/cli/src/args.ts:109-129` |
| 业务开发 | 写 `boat/agents/<id>` 目录、`--plugin` 文件、`--patch` 文件的人 | 业务逻辑只放在 agent 目录里，框架包不带业务词汇 | `CLAUDE.md:75` |
| dsh 上游 | `deepseek-ai/deepseek-harness` 仓库 | boat 每个 tag 导入一次内核源码，三方合并 boat 的改动 | `dsh.upstream.json`，`CLAUDE.md:189-190` |
| npm 官方包 | 除内核外的 `@deepseek-ai/dsh-*` | 原样使用，版本全钉在 `0.1.7-rc.1` | `.pnpmfile.cjs:7-22`，`pnpm-workspace.yaml:64-149` |
| 社区插件 | 按 dsh 接口写的第三方插件 | 不改代码即可跑在 boat 上；要用 boat 扩展时注入 `boatDistro` | `compatibility/COMPAT.md:46` |
| 模型服务 | DeepSeek Messages API 兼容端点 | `dsh-llm-deepseek` 适配器 POST 到 `messagesApiRoot(baseURL)/messages`：baseURL 不以 `/v1` 结尾时补上 `/v1`；baseURL 来自 `DEEPSEEK_BASE_URL`，默认值是 `config.ts:115` 的公开端点。本文的运行把它设成脚本化模型的 `http://127.0.0.1:<port>/v1`，请求就落在 `/v1/messages` | `dsh@rc.1:packages/llm/llm-deepseek/src/adapter.ts:113`，`messages-api.ts:11-14`，`config.ts:115-118` |

**为什么这样划边界**：boat 同时对两边负责——对用户，它是一个能跑业务 agent 的 harness；对 dsh 生态，它承诺“协议、接口、行为与跟踪的 release 一致”（`compatibility/COMPAT.md`）。所以 C1 里 dsh 上游和社区插件都是一等的外部系统：前者决定 boat 的内核从哪来，后者决定 boat 的内核不能随便改。

### 1.2 C2 容器

```mermaid
flowchart TB
  subgraph PROC["一个 boat 进程：node boat/apps/cli/lib/bin.js"]
    cli["@boat/cli 启动器<br/>参数、profile 模板、boot"]
    subgraph TREE["Cordis 插件树：profile run 组合出 100 行"]
      base["dsh-base 的行<br/>npm bundle"]
      host["@boat/host 的行<br/>boat 的宿主服务"]
      runb["@boat/run 的行<br/>一次性任务模式"]
    end
    subgraph KERNEL["dsh/ 内核 13 包"]
      kpk["dsh-llm · dsh-tools · dsh-skill<br/>dsh-session · dsh-system-prompt<br/>dsh-agent · dsh-agent-loop · 投影 · 持久化 · 压缩"]
    end
    npmpk["npm 上的其余 dsh 包<br/>app-boot · agent-preset-registry<br/>llm-deepseek · user-approval ..."]
    plugins["boat plugins<br/>distro · tool-policy · skill-router<br/>a2ui · history-import"]
    agents["agents<br/>boat/agents/demo 的 4 行"]
  end
  prof["profile 目录与 patch 层<br/>$BOAT_HOME/profiles/run"]
  store["会话存储<br/>$BOAT_HOME/sessions/.../session.v4.jsonl.zstd"]
  model["模型服务"]
  cli -->|"初始化、读取 patch"| prof
  cli -->|"boot()"| TREE
  base -->|"行名解析到包"| KERNEL
  base -->|"行名解析到包"| npmpk
  host -->|"行名解析到包"| plugins
  runb -->|"声明 agent 目录"| agents
  agents -->|"注入宿主服务"| plugins
  plugins -->|"只经接缝调用"| KERNEL
  KERNEL -->|"JSONL 后端写入"| store
  npmpk -->|"llm-deepseek 适配器"| model
```

| 容器 | 路径 | 职责 | 运行时产物 |
|---|---|---|---|
| boat 启动器 | `boat/apps/cli`（`bin.ts`、`cli.ts`、`args.ts`、`profile-boot.ts`、`templates.ts`、`plugins.ts`） | 解析启动器自己的参数，按模板初始化 profile，叠 patch 层，调用 dsh 的 `boot()`，处理退出信号 | `boat/apps/cli/lib/bin.js` |
| profile 与 patch 层 | `$BOAT_HOME/profiles/<name>/`（`package.json` 的 `dsh.profile.bundles`、`cordis.yml`、`cordis.patch.yml`） | 决定这次启动由哪些 bundle 组成，以及用户层覆盖 | 首次运行时由 `initProfile` 写出 |
| bundle：dsh-base | npm `@deepseek-ai/dsh-base` 的 `cordis.patch.yml` | dsh 所有基于 base 的 profile 共享的行：llm、session、tools、skill、agent-loop、持久化、审批、沙箱… | 行 |
| bundle：`@boat/host` | `boat/bundles/host/cordis.patch.yml` | 每个 boat profile 都带的宿主行：5 个 boat 服务，关闭 session-log 上传 | 行 |
| bundle：`@boat/run` | `boat/bundles/run/cordis.patch.yml` + `src/` | 一次性任务模式：解析任务和 `--agent`，声明 agent，驱动一个 turn，打印答案，退出 | 行 + runner 代码 |
| 内核 | `dsh/`（13 包） | 服务 `llm`、`tools`、`skills`、`sessions`、`systemPrompt`、`sessionProjections`、`sessionPersistence`、`compaction`、`agents`、`agentLoop`；driver 本身 | `dsh/*/*/lib/` |
| 其余 dsh 包 | `node_modules/@deepseek-ai/*` | 启动（app-boot）、preset 注册、模型适配、审批、沙箱、检查点、标题… | npm 发布物 |
| boat plugins | `boat/plugins/*` | 在 dsh 接缝上实现 ark 的能力 | `lib/` |
| agents | `boat/agents/<id>/` | 业务 agent 的组合（`agent.cordis.yml`）与业务代码（`src/` → `lib/`） | 行 + skills + 模板 |
| 会话存储 | `$BOAT_HOME/sessions/<编码后的 cwd>/<session-id>/session.v4.jsonl.zstd` | 追加式事件日志，每次落盘一个 zstd 帧 | 文件 |
| 模型服务 | 外部 | 回答循环请求、路由请求、标题请求 | HTTP |

**为什么是这几个容器**：`boat/` 下一个目录就是一层（`CLAUDE.md:43`）。apps 只拥有进程，bundles 只做组合、不写行为，plugins 挂在接缝上，agents 放业务。新的运行模式（比如 SDK 入口）应该是一个新的 `boat/bundles/<name>`，而不是在 `@boat/run` 里加分支。这让“换一种跑法”只是换 profile 的 bundle 列表（`templates.ts:17-24` 里 `run` 和 `web` 只差最后一个 bundle）。

### 1.3 C3 组件：服务、事件、投影

```mermaid
flowchart LR
  subgraph KS["内核服务 dsh/"]
    llm["llm"]
    tools["tools"]
    skills["skills"]
    sessions["sessions"]
    sp["systemPrompt"]
    proj["sessionProjections"]
    persist["sessionPersistence"]
    agentsS["agents"]
    loop["agentLoop"]
  end
  subgraph NS["npm 服务"]
    approval["approval"]
    presets["agentPresets"]
    dm["agentDefaultModel"]
  end
  subgraph BS["boat 宿主服务 @boat/host"]
    distro["boatDistro"]
    tp["toolPolicy"]
    sr["skillRouter"]
    a2ui["a2ui"]
    hi["historyImport"]
  end
  subgraph RS["@boat/run"]
    startup["boatRunStartup"]
    runner["boat-run 行"]
  end
  subgraph PS["boat 的投影"]
    pState["boatState"]
    pCards["boatCards"]
    pSkill["boatActiveSkill"]
  end
  loop --> agentsS & sessions & llm & tools & sp & proj
  tools --> sp
  tp --> tools & proj & sp
  sr --> skills & llm & proj & sp & tools & tp
  a2ui --> tools & tp & proj
  presets --> startup
  runner --> dm & agentsS & sessions & hi & startup
  tp -.->|"注册"| pState
  a2ui -.->|"注册"| pCards
  sr -.->|"注册"| pSkill
  tools -.->|"ctx.get，可选"| approval
  loop -.->|"ctx.get，可选"| persist
```

实线箭头 A → B 表示 A 注入 B（`static inject` 或行级 `inject`）；B 缺一个，A 就不激活，停在 PENDING。虚线表示可选访问（`ctx.get`）或注册关系。

| 组件 | 服务键 | 发布者（文件） | 它做什么 |
|---|---|---|---|
| 模型访问 | `llm` | `dsh/llm/llm/src/index.ts:346` | 适配器注册表 + `llm/stream` waterfall；所有模型调用（循环、路由、标题）都从这里走 |
| 工具注册表与运行时 | `tools` | `dsh/core/tools/src/index.ts:848` | 注册、可见性限制（`restrict`）、`tools/pre-execute`/`execute`/`post-execute`/`result` |
| skill 目录 | `skills` | `dsh/skill/skill/src/index.ts:374` | skill provider 聚合，`snapshot` / `get` |
| 会话 | `sessions` | `dsh/core/session/src/index.ts:935` | `Session` 的创建、`append`、`flush`、`deriveMessages` |
| 系统提示 | `systemPrompt` | `dsh/core/system-prompt/src/index.ts:422` | section、context、变量的注册与 `assemble` |
| 投影注册表 | `sessionProjections` | `dsh/session/session-projection/src/index.ts:208` | 每次 append 后跑所有投影的 `apply` |
| 持久化 | `sessionPersistence` | 抽象基类 `dsh/session/session-persistence/src/index.ts:140`，JSONL 实现 `dsh/session/session-persistence-jsonl` | 创建 / 追加 / 读取会话日志 |
| agent 注册表 | `agents` | `dsh/core/agent/src/index.ts:245-256` | `create`，工厂由 agent-loop 注入（`setFactory`） |
| driver 工厂 | `agentLoop` | `dsh/core/agent-loop/src/index.ts:333-375` | 创建并托管 `ReactLoopAgent`（作为 `agents` 的工厂）；turn / step 循环本身在 `ReactLoopAgent.turn` / `step`（`dsh/core/agent-loop/src/agent.ts:314-611`） |
| 审批 | `approval` | npm `dsh-user-approval` | `tools/pre-execute` 返回 `ask` 时的确认通道 |
| preset 注册表 | `agentPresets` | npm `dsh-agent-preset-registry`（`dsh@rc.1:packages/preset/agent-preset-registry/src/index.ts:51-72`） | 把 agent 目录的行挂到 standing scope，再绑定到每个 agent 实例 |
| 默认模型 | `agentDefaultModel` | npm `dsh-agent-default-model` | 给 runner 提供 provider/model 选择 |
| 发行版标记 | `boatDistro` | `boat/plugins/distro/src/index.ts:16-27` | 列出本构建携带的内核扩展 |
| 工具策略 | `toolPolicy` | `boat/plugins/tool-policy/src/index.ts:99-132` | `always` / `auto` 可见性、确认、state delta，`boat:state` context |
| skill 路由 | `skillRouter` | `boat/plugins/skill-router/src/index.ts:149-206` | `off` / `full` / `dynamic` 三种加载模式，ark 的 LLM 路由，`boat:skill` context |
| 卡片 | `a2ui` | `boat/plugins/a2ui/src/index.ts:159-167` | ark 的 A2UI 模板引擎，`render_a2ui` 工具 |
| 历史导入 | `historyImport` | `boat/plugins/history-import/src/index.ts:50-53` | 把外部 SA 历史变成会话 seed |

**事件与投影**（完整列表见 [7.2](#72-事件一览表)）：

| 类别 | 名字 | 谁产生 | boat 谁在用 |
|---|---|---|---|
| boat 的内核扩展事件 | `boat/intake`、`boat/pre-assemble`（waterfall） | `ReactLoopAgent.preStep`（`dsh/core/agent-loop/src/agent.ts:279-288`） | demo-hooks；tool-policy、skill-router |
| dsh 工具事件 | `tools/pre-execute`、`tools/result` | tools 运行时 | tool-policy（确认）；skill-router（模型自己加载 skill） |
| boat 的日志节点 | `boat/route-request`、`boat/skill-routed` | skill-router | `boatActiveSkill` 投影 |
| boat 借用的 dsh 信封 | `tool/result.meta.boat.{card,stateDelta}`；intake 回复的 `assistant/message.source.provider = 'boat'` | 工具的 `presentationMeta`；driver 的 `replyStep` | `boatCards`、`boatState` 投影 |
| boat 的投影 | `boatState`、`boatCards`、`boatActiveSkill` | tool-policy、a2ui、skill-router 注册 | `boat:state` context、web 客户端 |

**为什么宿主服务 + agent 行两段式**：`toolPolicy`、`skillRouter` 这些服务在根 realm 里只有一份，监听所有 agent 的事件；每个 agent 自己的策略（路由模式、哪些工具归它）由 agent 行在自己的 scope 里声明，服务按 agent 的 scope 链去读（`ScopedLayers`）。所以 demo 的行 `boat-skill-router`（`@boat/skill-router/agent`）只写配置 `{mode: dynamic, historyWindow: 6, timeoutMs: 10000}`（`boat/agents/demo/agent.cordis.yml:13-18`），不发布服务。agent 行禁止往根 realm 发布服务（`CLAUDE.md:74`），dsh 的 preset 挂载会直接拒绝（`dsh@rc.1:packages/preset/agent-preset-registry/src/mount.ts:265-267`）。

### 1.4 C4 代码：关键类型与文件

```mermaid
flowchart TB
  subgraph AGT["dsh/core/agent"]
    agentT["interface Agent<br/>types.ts:15，成员在 runtime-types.ts:163-243"]
    reg["class AgentRegistry<br/>服务 agents，index.ts:245"]
  end
  subgraph LOOP["dsh/core/agent-loop"]
    al["class AgentLoop<br/>服务 agentLoop，index.ts:333"]
    rla["class ReactLoopAgent<br/>agent.ts:102"]
    hooks["boat/step-hooks.ts<br/>boat/intake · boat/pre-assemble"]
  end
  subgraph SESS["dsh/core/session"]
    store["class SessionStore<br/>服务 sessions，index.ts:907"]
    sess["class Session<br/>append · deriveMessages，index.ts:444"]
    sem["interface SessionEventMap<br/>types.ts:281"]
  end
  subgraph CON["@boat/contracts"]
    cEv["SessionEventMap 合并<br/>boat/route-request · boat/skill-routed"]
    cProj["SessionProjectionStateMap 合并<br/>boatState · boatActiveSkill · boatCards"]
    cMeta["BoatToolMeta · BoatSkillMeta · BoatCard · BoatDistro"]
    cRe["重导出 IntakeDecision · IntakeReply · BoatStepPayload"]
  end
  al -->|"setFactory(this)"| reg
  al -->|"new"| rla
  rla -->|"implements"| agentT
  rla -->|"dispatch waterfall"| hooks
  rla -->|"append"| sess
  store -->|"持有"| sess
  sess -->|"事件类型来自"| sem
  cEv -.->|"declare module 合并"| sem
  cRe -.->|"export type from dsh-agent-loop"| hooks
```

| 类型 / 文件 | 作用 | 要点 |
|---|---|---|
| `Agent`（`dsh/core/agent/src/types.ts:15`，成员由 `runtime-types.ts:163-243` 的 `declare module` 补上） | agent 实例接口 | `session`、`ctx`、`options`、`followup` / `steer` / `inject`、`whenIdle()` |
| `ReactLoopAgent`（`dsh/core/agent-loop/src/agent.ts:102`） | 唯一的 driver 实现 | 构造时 `createScope(loopCtx, this)` 造出 agent scope（`agent.ts:134`）；`preStep`（271-304）、`turn`（314-421）、`step`（461-611）、`replyStep`（438-459） |
| `BoatStepPayload` / `BoatIntakeDecision`（`dsh/core/agent-loop/src/boat/step-hooks.ts:23-63`） | 两个扩展事件的声明 | `boat/intake` 返回 `{kind:'pass'}` 或 `{kind:'reply', plugin, content}`；`BOAT_ASSISTANT_PROVIDER = 'boat'`（16） |
| `Session`（`dsh/core/session/src/index.ts:444`） | 一个会话的事件日志 | `append`（720-765）是唯一写入口；`deriveMessages`（842）从带 `surfaceOp` 的事件推导出模型看到的消息 |
| `SessionEventMap`（`dsh/core/session/src/types.ts:281`） | 日志事件的类型表 | 可被 `declare module` 合并；持久化只认编译进来的类型（`known-event-types.ts`） |
| `@boat/contracts`（`boat/core/contracts/src/index.ts`） | boat 唯一的共享声明处 | 事件（36-41 重导出）、日志节点（133-151）、投影键（153-170）、`BoatToolMeta`（89-102）、`BoatDistro`（60-73） |
| `@boat/cordis-compat`（`boat/core/cordis-compat/src/index.ts:14-21`） | `FiberState` 的运行时值 | 发布版 cordis 用 `const enum`，esbuild/vitest 不内联，所以 boat 自己写一份 |

`boat/intake` 的声明本身就是一个很好的“扩展一个 dsh 接缝”的例子（`dsh/core/agent-loop/src/boat/step-hooks.ts:44-63`）：

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'boat/intake'(this: Scoped<Agent>, payload: BoatStepPayload, next: () => Promise<BoatIntakeDecision>): Promise<BoatIntakeDecision>
    'boat/pre-assemble'(this: Scoped<Agent>, payload: BoatStepPayload, next: () => Promise<void>): Promise<void>
  }
}
```

**为什么事件声明在内核、类型从 contracts 读**：内核不能 import 任何 `@boat/*`（`CLAUDE.md:63` 由 `scripts/check-layers.ts` 检查），所以声明必须在内核里；boat 的插件之间也不能互相 import 值，只能依赖 `@boat/contracts`，于是 contracts 把内核里的类型重导出一遍（`boat/core/contracts/src/index.ts:28-41`）。

---

## 2. 生命周期与依赖注入

### 2.1 Cordis 的六个概念

| 概念 | 是什么 | 在 boat 里的例子 |
|---|---|---|
| **Context** | 服务的容器。根 Context 在 `boot()` 里创建（`dsh@rc.1:packages/boot/app-boot/src/index.ts:977`），每个插件拿到一个继承父级的子 Context | `ctx.extend({ baseUrl })` 把 agent 目录作为 base URL 交给 preset 注册表（`boat/bundles/run/src/index.ts:168`） |
| **plugin** | 一个导出 `name`、`inject`、`Config`、`apply(ctx, config)` 的模块 | `@boat/run/startup`（`boat/bundles/run/src/startup.ts:21-96`）、`demo-hooks`（`boat/agents/demo/src/hooks.ts:10-27`） |
| **Service** | `Service` 子类；构造函数里 `super(ctx, key)` 就把自己发布成 `ctx[key]`（`dsh@rc.1:vendor/cordis/src/service.ts:42-58`） | 所有内核服务和 boat 宿主服务，比如 `ToolPolicyService`（`boat/plugins/tool-policy/src/index.ts:99-106`） |
| **inject** | 声明依赖的服务名；**全部到齐才加载**（`dsh@rc.1:vendor/cordis/src/registry.ts:105-106`）。行级 `inject` 会合并进同一个集合（`dsh@rc.1:vendor/loader/src/index.ts:129-135`） | `AgentLoop.inject = ['agents','sessions','llm','tools','systemPrompt','sessionProjections']`（`dsh/core/agent-loop/src/index.ts:334`）；`@boat/run` 的行级 `inject: [boatRunStartup]`（`boat/bundles/run/cordis.patch.yml:26,32`） |
| **fiber** | 插件实例的生命周期对象，状态见下图 | 启动审计打印的 `pending (waiting for service: X)` 就是 PENDING 状态 |
| **effect / disposer** | `ctx.effect(execute, label)`（`dsh@rc.1:vendor/cordis/src/fiber.ts:415`）登记副作用，卸载时逆序执行 disposer；`ctx.on` 和各注册表的 `register()` 都返回 disposer | `boat-run` 把 agent 声明放进 effect（`boat/bundles/run/src/index.ts:170`），声明随 `boat-run` 这个 fiber 一起消失；`AgentLoop` 用 effect 登记自己为工厂（`dsh/core/agent-loop/src/index.ts:372`） |

```mermaid
stateDiagram-v2
  [*] --> PENDING: ctx.plugin 创建 fiber
  PENDING --> LOADING: inject 的服务全部可用
  LOADING --> ACTIVE: apply 或构造函数完成
  LOADING --> FAILED: apply 或 Config 抛错
  ACTIVE --> UNLOADING: 依赖消失或被替换，或行被移除、父级释放
  UNLOADING --> PENDING: 依赖仍缺，等待
  UNLOADING --> LOADING: 依赖已换新，重新加载
  UNLOADING --> DISPOSED: 行被移除或父级释放，disposers 逆序跑完
  DISPOSED --> [*]
```

状态值 PENDING 0、LOADING 1、ACTIVE 2、FAILED 3、DISPOSED 4、UNLOADING 5（`dsh@rc.1:vendor/cordis/src/fiber.ts:147-154`，boat 的镜像在 `boat/core/cordis-compat/src/index.ts:14-21`）。fiber 不会从 ACTIVE 直接跳到 DISPOSED：释放时先把 `uid` 置空、epoch 设为 INACTIVE，在 UNLOADING 里跑 `_unload`（逆序执行 disposer），之后 `_getState()` 才报告 DISPOSED（`fiber.ts:264-290`、`574-579`、`666-676`）。一个 fiber 的 epoch 由它所依赖服务的 fiber uid 拼成（`fiber.ts:611-622`），epoch 变了就卸载再加载（`fiber.ts:624-638`）——**依赖是响应式的**。

**这和 ark 最大的不同**：ark 的 `Bootstrap` 按列表顺序先逐个 `init`、再逐个 `start`，把 `start` 的返回值挂到 `ctx.{name}` 上，停止时逆序 `stop`（ark-agentic `src/ark_agentic/core/protocol/bootstrap.py:125-190`）——`ctx.{name}` 这一点和 Cordis 的 `super(ctx, key)` 很像；但 Cordis 里行的顺序没有加载语义，激活顺序完全由“服务什么时候可用”决定（dsh-base 的注释写明了：`dsh@rc.1:packages/bundle/base/cordis.patch.yml:12-13`）。我们用一个 `--plugin` 探针验证过：探针行排在所有层的最后、不注入任何服务，它 apply 的时候 `llm`、`toolPolicy`、`agentPresets` 都还没出现（[3.3](#33-启动时能看到的真实输出)）。

**可选依赖怎么写**：`inject` 永远是必需的。可选访问有两种写法：

- `ctx.get('x')`：拿一次，不响应变化。例：tools 运行时拿审批服务（`dsh/core/tools/src/index.ts:1730`），agent-loop 拿 `sessionPersistence`（`dsh/core/agent-loop/src/index.ts:683`），`boat-run` 拿 `agentPresets`、`appExit`、`loader`（`boat/bundles/run/src/index.ts:185,193,248`）。
- 嵌套 `ctx.inject(['x'], cb)`：一个子 fiber，`x` 到了才跑。例：preset 注册表对 `settings` 的用法（`dsh@rc.1:packages/preset/agent-preset-registry/src/index.ts:68`）。

**事件的四种派发方式**。ark 的 `RunnerCallbacks` 是固定的回调槽位；dsh 里“回调”全是事件，谁都能挂，派发方式决定返回值和顺序的含义（`dsh@rc.1:vendor/cordis/src/events.ts`）：

| 方式 | 代码 | 顺序 | 返回值 | 能否否决 | 例子 |
|---|---|---|---|---|---|
| `emit` | `events.ts:194` | 同步依次调用，不等 Promise | 忽略 | 不能 | `agent/inbox/inserted`、`tools/result`、`session/event` |
| `parallel` | `events.ts:183` | 所有监听并发，等全部结束 | 忽略；有监听抛错就抛 `AggregateError` | 不能 | `session/flush`（`sessions.flush` 自己收集监听后 `Promise.allSettled`，语义相同，`dsh/core/session/src/index.ts:1176-1193`） |
| `serial` | `events.ts:204` | 依次 await | 第一个非空返回值就停下并返回它 | 能（返回非空即截断） | `agent/turn-stopping` |
| `waterfall` | `events.ts:234` | 洋葱式：先注册的在最外层，每层调 `next()` 进入里层 | 最外层的返回值 | 能（不调 `next()`，里层和默认行为都不执行） | `boat/intake`、`boat/pre-assemble`、`agent/pre-step`、`tools/pre-execute` |

**waterfall 监听的顺序就是注册顺序**（`events.ts:254-260`：默认 `push`，先注册的在最外层；监听时传 `prepend: true` 会 `unshift` 到最外层）。skill-router 注入了 `toolPolicy`，所以一定比 tool-policy 晚激活、晚注册监听，于是在 `boat/pre-assemble` 里 tool-policy 在外层、skill-router 在里层。tool-policy 的代码注释写的“在 `next()` 之后对齐”（`boat/plugins/tool-policy/src/index.ts:117-123`）依赖的就是这个顺序：里层（skill-router、agent 行、注入了 `toolPolicy` 的 `--plugin` 行，比如 `tools.mjs` 的 `inject = ['toolPolicy']`，`boat/bundles/run/tests/fixtures/plugins/tools.mjs:9`）都激活完工具之后，它最后算一次限制。不注入任何服务的 `--plugin` 行反而比 tool-policy 先 apply、先注册，处在最外层；但 `activate()` 和 `clear()` 自己会立即 `reconcile`（`boat/plugins/tool-policy/src/index.ts:187-207`），所以可见性结果不变。

**想在整棵树起来之后跑一次代码怎么办**。ark 的 `Lifecycle.start` 保证在所有 `init` 之后运行；Cordis 没有这个阶段，有两种替代：

- 注入启动器发布的 `appReady`，用 `appReady.onReady(listener)`：boat 的启动器在 `boot()` 返回、根 fiber 是 ACTIVE、`loader` 还在时才 `commit()`（`boat/apps/cli/src/profile-boot.ts:58-79`、`246-251`）。
- 像 `boat-run` 那样 `await ctx.get('loader')?.await()`（`boat/bundles/run/src/index.ts:185`）：等 Loader 把当前能激活的行都处理完。`boat-run` 的 `apply` 不等待这个 Promise（`index.ts:253`），所以不会拖住 `boot()`。

### 2.2 根 realm、standing scope 与 agent scope

```mermaid
flowchart TB
  subgraph ROOT["根 realm：65 个服务"]
    rsvc["llm · tools · skills · sessions · systemPrompt<br/>toolPolicy · skillRouter · a2ui · agentPresets ..."]
  end
  subgraph STAND["demo 的 standing scope：preset 注册表创建，每个 preset 修订一个"]
    rows["persona · boat-skill-router · demo-tools · demo-hooks<br/>注册的工具、skill、路由配置、监听都记在这层"]
  end
  subgraph AGS["agent scope：每个 agent 实例一个，ReactLoopAgent 构造时创建"]
    inst["session-2b1b...<br/>agent.ctx"]
  end
  inst -->|"bindScopeParent"| rows
  rows -->|"继承"| rsvc
```

| 层 | 谁创建 | 生命周期 | 例子 |
|---|---|---|---|
| 根 realm | `boot()`；没有 `isolate` 的服务都发布在这里 | 进程 | `run` 组合下 65 个服务全在根 realm |
| standing scope | preset 注册表 `activate` 调 `createScope(owner, key)`（`dsh@rc.1:packages/preset/agent-preset-registry/src/index.ts:108-124`） | 一个 preset 修订（代码里叫 generation），声明撤销并且没有 agent 再绑定它时才释放（见下文） | demo 的 4 行挂在这里，`auditRows` 看到 4 行都是 fiberState 2 |
| agent scope | `ReactLoopAgent` 构造时 `createScope(loopCtx, this)`（`dsh/core/agent-loop/src/agent.ts:134`） | 一个 agent 实例 | setup 里 `presets.mount` 调 `bindScopeParent(agentKey, standingKey)`（registry `index.ts:248-257`），链变成 agent → standing → 全局 |

**为什么需要 scope**：同一个进程里可能有多个 agent（`boat web` 就是）。`ScopedLayers` 类的注册表（tools、skills、toolPolicy、skillRouter）读的是“全局层 + 这条 scope 链”，scoped 事件的投递规则在 `scopeTarget` 的过滤器里（`dsh@rc.1:packages/core/scope/src/index.ts:158-185`）：无 scope 标签的监听（比如根 realm 里的 `toolPolicy`）收到所有事件；带标签的监听只有在它的 scope 是派发 key 或其祖先时才收到——事件沿链往上流，不往下流。结果是：demo 的 `boat/intake` 监听只听得到 demo 的 agent；demo 注册的 `asset_overview` 只在 demo 的 agent 里可见；另一个 agent 完全不受影响。每个 agent 的运行期状态用 `WeakMap<Agent, …>` 存（`boat/plugins/tool-policy/src/index.ts:103`，`boat/plugins/skill-router/src/index.ts:153`），agent 没了状态就没了。

**standing scope 什么时候释放**。preset 注册表给每次激活记一个 `Generation {scope, key, mount, users, retired}`（`dsh@rc.1:packages/preset/agent-preset-registry/src/index.ts:30-36`）：

- `users`：绑定在它上面的 agent 数。`mount` 时 `retain` 先临时 +1，`bind` / `join` 为这个 agent 再 +1，`mount` 结束把临时的 −1；agent 的 scope 释放时，`join` 登记的 effect 再 −1（`index.ts:215-273`）。
- `retired`：声明被撤销时置为 true（`register` 返回的 disposer，`index.ts:93-101`）。在 `boat run` 里，这个 disposer 挂在 `boat-run` 的 `ctx.effect` 上（`boat/bundles/run/src/index.ts:170`）。
- 只有 `retired && users === 0` 时 `collect` 才释放 standing scope（`index.ts:150-154`）。

所以 standing scope 可能比声明活得久（声明撤了、还有 agent 绑着），也可能比某个 agent 活得久（agent 没了、声明还在）。同一个 id 不能重复注册（`index.ts:89`）；声明被替换（先撤销再注册）会生成新的 generation，已经绑在旧 generation 上的 agent 不会自动迁移，只有 agent 自己再次 `mount` 时 `bind` 才把它 `rebind` 到新的（`index.ts:233-246`），旧 standing scope 要等最后一个 agent 解绑才释放。

**realm、isolate、group**。上面说的“根 realm”是服务键的命名空间：一个服务 `super(ctx, 'x')` 发布后，同一 realm 里的 `ctx.x` 都指向它。行上写 `isolate: {x: true}` 时，Loader 给这一行开一个本行私有的 realm（`LocalRealm`，`dsh@rc.1:vendor/loader/src/config/isolate.ts:49-57`），子行继承这张映射，所以 `x` 只在这一行及其子行里可见；写成 `isolate: {x: '<标签>'}` 则进入按标签共享的 realm（`GlobalRealm`，`isolate.ts:60-68`）。要让一个服务的提供者和它的消费者共享同一个私有 realm，就把它们包进一个 `cordis:group` 行（app-boot 把 `group` 注册为内置，`dsh@rc.1:packages/boot/app-boot/src/index.ts:556-561`）。例子在 web 的 standard preset 里：

```yaml
- id: planning
  name: cordis:group
  group: true
  isolate:
    planMode: true
  config:
    - id: plan-mode
      name: '@deepseek-ai/dsh-plan-mode'
```

（`dsh@rc.1:packages/bundle/web-app/presets/standard.patch.yml:42-49`）。`run` 组合里没有 `isolate` 行，所以 65 个服务全在根 realm；`web` 组合里有，服务数要分开数（见 [3.3](#33-启动时能看到的真实输出)）。

### 2.3 dsh 与 boat 的 DI 怎么交互

原则：**服务由谁发布、由谁注入，全写在代码的 `super(ctx, key)` 和 `inject` 里，跨包不 import 值**。boat 的服务依赖 dsh 的服务；dsh 的服务不知道 boat 的存在；agent 行同时注入两边。

| 服务 | 发布者 | 在 run 组合里的主要注入者（节选；完整列表见 [7.1](#71-服务一览表)） |
|---|---|---|
| `llm` | 内核 `llm` 行 | agent-loop、compaction-basic、llm-deepseek、session-title-llm、session-checkpoint-policy、**skillRouter** |
| `tools` | 内核 `tools` 行 | agent-loop、各 tool-* 行、spill-policy、plan-mode、**toolPolicy**、**skillRouter**、**a2ui**、**demo-tools** |
| `skills` | 内核 `skill` 行 | skill-filesystem、tool-skill、**skillRouter**、**demo-tools** |
| `sessionProjections` | 内核 `session-projection` 行 | agent-loop、agent-preset-registry、token-meter、permission、session-projection-cache、**toolPolicy**、**skillRouter**、**a2ui**、**demo-tools** |
| `systemPrompt` | 内核 `system-prompt` 行 | tools、agent-loop、persona、plan-mode、**toolPolicy**、**skillRouter** |
| `agents`、`sessions` | 内核 `agent`、`session` 行 | agent-loop；**boat-run** |
| `toolPolicy` | `@boat/host` 的 `boat-tool-policy` 行 | skillRouter、a2ui、`@boat/tool-policy/agent` 行、**demo-tools** |
| `skillRouter` | `boat-skill-router` 行 | `@boat/skill-router/agent` 行（demo 的第 2 行） |
| `boatRunStartup` | `@boat/run/startup` 行 | `agent-preset-registry` 行和 `boat-run` 行（行级 `inject`） |

**例子 1：一个 agent 行同时用内核服务和 boat 服务**。`boat/agents/demo/src/tools.ts:22`：

```ts
export const inject = ['tools', 'toolPolicy', 'a2ui', 'skills', 'sessionProjections']
```

`tools`、`skills`、`sessionProjections` 来自内核，`toolPolicy`、`a2ui` 来自 `@boat/host`。它在 apply 里挂一个 scoped 的 `dsh-skill-filesystem` 子插件（38 行），再通过 `ctx.toolPolicy.register(...)` 注册两个 `visibility: 'auto'` 的工具（40-108 行）。这个行在 demo 的 standing scope 里，所以注册的工具和 skill 都落在 demo 那一层。

**例子 2：行级 inject + 延迟求值的配置**。`boat/bundles/run/cordis.patch.yml:24-28`：

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  inject: [boatRunStartup]
  config:
    default: !!js ctx.boatRunStartup.preset ?? 'none'
```

`!!js` 表达式在这一行自己的 Context 里求值（`dsh@rc.1:vendor/loader/src/index.ts:104-113`），而行级 `inject` 保证求值时 `ctx.boatRunStartup` 已经存在。**为什么这样写**：preset 注册表是上游 npm 包，boat 不改它的代码；只要在 patch 里给它加一个依赖，就能让它的默认 preset 取决于 boat 解析的命令行。

**例子 3：服务缺了会怎样**。用 `--patch` 禁掉 `boat-history-import`：

```console
$ cat disable-history.yml
- id: boat-history-import
  disabled: true
$ node boat/apps/cli/lib/bin.js run --patch disable-history.yml "hello"
boat: warning: 1 entry did not activate
boat-run (@boat/run): pending (waiting for service: historyImport)
```

`boat-run` 静态注入了 `historyImport`（`boat/bundles/run/src/index.ts:40`），于是停在 PENDING。启动审计只把 `agent-loop`、`webserver`、`headless-runner` 等 7 个 id 当作“必须激活”（`dsh@rc.1:packages/boot/app-boot/src/index.ts:744-752`），`boat-run` 不在里面，所以只打一条 warning，进程随后一直挂着（我们用 `timeout 20` 杀掉，退出码 124）。见 [7.4](#74-已知的坑)。

### 2.4 boat 怎么覆盖 dsh

| # | 机制 | 覆盖了什么 | 在哪 | 具体例子 |
|---|---|---|---|---|
| 1 | **同名接管**（pnpm `overrides`） | 内核 13 个包的实现 | `pnpm-workspace.yaml:16-29`；`.pnpmfile.cjs:7-22` 对内核名不钉版本 | `node_modules/@deepseek-ai/dsh-llm -> ../../dsh/llm/llm`；npm 包 `dsh-llm-deepseek` 在 `.pnpm` 里依赖的 `dsh-llm` 用 `readlink -f` 看也落到仓库的 `dsh/llm/llm`；store 里没有任何 npm 版的 `dsh-llm`（`3d29a07` 提交说明） |
| 2 | **patch 层增删改行** | 组合：加行、禁行、换配置 | `boat/bundles/host/cordis.patch.yml`、`boat/bundles/run/cordis.patch.yml` | `@boat/host` 把 `session-log-deepseek` 设为 `enabled: false`（`host/cordis.patch.yml:10-12`，提交 `f2e4e00`：0.1.7 起它默认会把会话日志附到每个官方请求上）。关掉的只是会话日志：dsh-base 的 `plugin-package-inventory-deepseek` 行（`dsh@rc.1:packages/bundle/base/cordis.patch.yml:77-78`）仍然给每个官方请求附上 `dsh_plugin_packages`（已加载的插件包名和版本，含 `@boat/run`、`@boat/agent-demo`、`@boat/skill-router` 等），所以 host bundle 注释里的“boat sends the provider the model request only”（`host/cordis.patch.yml:7-9`）要打这个折扣，见 [5.4](#54-日志怎么映射回模型看到的内容)；`@boat/run` 禁掉 `hmr`（`run/cordis.patch.yml:40-41`）、整体替换 `system-prompt` 和 `tools` 两行的配置（10-18）、插入 3 行代替 dsh-headless（20-37） |
| 3 | **内核扩展事件** | driver 的行为：在组装提示词之前多派发两个 waterfall | `dsh/core/agent-loop/src/agent.ts:276-289`；声明在 `boat/step-hooks.ts:44-63`；登记在 `compatibility/contract/extensions.yml:16-50` | 提交 `92698ff`（D1-4，`boat/intake`）和 `4870926`（D1-5，`boat/pre-assemble`），都带 `Dist-Change: extend` 和 `Dist-Extension` trailer；每个扩展写明退出条件：上游出现能在组装前改写 step 的事件时移除 |
| 4 | **`boatDistro` 标记服务** | 让第三方插件只在 boat 上加载 | `boat/plugins/distro/src/index.ts:16-27`；扩展列表由 `scripts/dist/gen-distro-manifest.ts` 生成到 `distro-manifest.ts` | `boat/bundles/run/tests/fixtures/plugins/distro-aware.mjs` 声明 `inject: ['boatDistro']`，实测输出 `boat on dsh 0.1.7-rc.1: agent-loop-intake, agent-loop-pre-assemble`；在官方 dsh 上它会停在 PENDING，不会去调一个不存在的扩展 |
| 5 | **`--plugin` 行** | 往树里临时插一个本地 ESM 插件 | `boat/apps/cli/src/plugins.ts:52-59`；叠在所有文件 overlay 之上（`profile-boot.ts:168-170`） | `boat run --plugin boat/bundles/run/tests/fixtures/plugins/tools.mjs "帮我调仓"`：注册 `lookup_assets`（always）和 `rebalance`（auto + 需确认），并在 `boat/pre-assemble` 里按用户文字激活 `rebalance`。实测日志：`tool/call rebalance {"target":"股债均衡"}` → `approval/asked {reason: tool "rebalance" requires confirmation}` → `approval/decided {outcome: unavailable}` → `tool/result isError=true`——`boat run` 没有组合审批应答者，默认结果 `unavailable` 按拒绝处理 |
| 6 | **用户 patch 层** | 某台机器、某次启动的配置 | profile 的 `cordis.patch.yml`、`$BOAT_HOME/cordis.patch.yml`、`--patch` 文件，按此顺序叠（`dsh@rc.1:packages/boot/app-boot/src/profile-context.ts:63-74`） | 上面 [2.3](#23-dsh-与-boat-的-di-怎么交互) 的 `disable-history.yml` |
| 7 | **自己的启动器** | dsh 的 CLI | `boat/apps/cli`（改编自上游 `apps/cli/src/profile-boot.ts`，差异列在文件头 `profile-boot.ts:16-21`） | boat 自己的模板表（`templates.ts:17-24`），bundle 列表漂移就报错（`profile-boot.ts:122-127`），`BOAT_HOME` 强制写进 `DSH_HOME`（`home.ts:47-50`），用户的 `~/.dsh` 永远不被碰 |
| 8 | **peer 写法约定** | 让 dsh 的启动准入放行 boat 的包 | `CLAUDE.md:84`，`scripts/upstream-pins.spec.ts` | `@boat/run` 的内核 peer 写 `workspace:*`，非内核 dsh peer 写精确版本 `"@deepseek-ai/dsh-agent-default-model": "0.1.7-rc.1"`（`boat/bundles/run/package.json:44-47`）。原因见提交 `edbe7bb`：准入读磁盘上的 manifest，pnpm 不会替换 `catalog:dsh`，于是在 rc.1 上启动器跳过了 `@boat/run`，还禁掉了 skill-router、a2ui、history-import 三行 |

看组合结果最直接的办法是 `config dump`，它会标出每一行来自哪个 bundle、被谁 patch 过：

```console
$ node boat/apps/cli/lib/bin.js config dump --profile run
# == @deepseek-ai/dsh-base, patched by @boat/run
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: true
  ...
# == @deepseek-ai/dsh-base, patched by @boat/host
- id: session-log-deepseek
  name: '@deepseek-ai/dsh-session-log-deepseek'
  config:
    enabled: false
...
# == @boat/host
- id: boat-distro
  name: '@boat/distro'
- id: boat-tool-policy
  name: '@boat/tool-policy'
...
```

**为什么覆盖手段按这个顺序选**：`CLAUDE.md:69` 规定“先在内核外面做”——能用 patch 配置就不写插件，能写插件就不改内核；非改内核不可时，改动要分类、要登记、要写退出条件，因为每一行内核改动都会让下一次上游同步更贵。上表 1–8 里只有第 3 项动了内核源码。

---

## 3. 系统启动时序

以 `node boat/apps/cli/lib/bin.js run --agents ./boat/agents --agent demo "看看资产"` 为例，从进程启动到 agent 就绪、任务交进 inbox。

### 3.1 时序图

```mermaid
sequenceDiagram
  autonumber
  participant BIN as bin.ts + home.ts
  participant CLI as cli.ts + args.ts
  participant PB as profile-boot.ts
  participant AB as dsh-app-boot
  participant LD as Loader + Include
  participant KR as 内核与 dsh-base 的行
  participant HO as boat/host 的行
  participant ST as boat-run-startup
  participant PR as agent-preset-registry
  participant RUN as boat-run
  participant AL as AgentLoop
  participant AG as ReactLoopAgent
  BIN->>BIN: installBoatHome, BOAT_HOME 写入 DSH_HOME
  BIN->>CLI: 动态 import cli.ts, runCli
  CLI->>CLI: parseBoatArgs, 模式 profile, profile 名 run
  CLI->>PB: runProfile(environment, patches, plugin overlay, args)
  PB->>AB: ensureProfileInitialized, initProfile 首次运行
  PB->>AB: loadProfile, 逐个 bundle 做准入并读 patch
  PB->>PB: 根 cordis.yml 重写为空列表
  PB->>AB: createRuntimeResolution
  PB->>AB: readProfilePatches, 按层排序并加遥测开关
  PB->>AB: boot(boat, rootConfig, patches, prepare)
  AB->>LD: new Context, ctx.plugin(Loader)
  AB->>PB: prepare 回调
  PB->>AB: provide profileContext, launchEnvironment, PluginPackages
  PB->>AB: provideCmdline, 发布 cmdlineArgs, appExit, appReady
  AB->>LD: mountRootInclude, 行准入后插入 100 行
  Note over LD,RUN: 以下激活先后只是阅读顺序, 实际由服务可用性决定
  LD->>KR: 逐行 import 并 registry.plugin
  KR-->>LD: llm, tools, skills, sessions, systemPrompt ... 陆续 ACTIVE
  KR->>AL: agent-loop 行激活, agents.setFactory
  LD->>HO: boatDistro, toolPolicy, skillRouter, a2ui, historyImport 激活
  LD->>ST: 注入 cmdlineArgs, 解析 --agents --agent 与任务
  ST-->>LD: provide boatRunStartup
  LD->>PR: 行级 inject 满足, 发布 agentPresets
  LD->>RUN: 行级 inject 满足, apply 启动 run 不等待
  AB->>AB: loader.await, auditStartupEntries
  AB-->>PB: 返回根 Context
  PB->>PB: 根 fiber ACTIVE, appReady.commit
  RUN->>RUN: loader.await 等宿主树稳定
  RUN->>PR: register demo 定义, 放在 effect 里
  PR->>PR: createScope standing, mountPreset 挂 4 行并审计
  RUN->>PR: resolve demo
  RUN->>AL: agents.create(sessionId, meta, agentOptions, setup)
  AL->>AL: sessions.prepare, sessionPersistence.create
  AL->>AG: new ReactLoopAgent, createScope agent
  AL->>PR: setup 回调里 presets.mount, bindScopeParent
  AL->>AL: publish, sessions.announce, agents.announce
  RUN->>AG: whenIdle 然后 followup 看看资产
```

### 3.2 逐步说明

**A. 进程入口**

1. `boat/apps/cli/src/bin.ts:8-12`：`home.ts` 是唯一的静态 import，先执行 `installBoatHome()`，再动态 import `cli.ts`。**为什么**：dsh 的 home 路径在每次调用时读 `DSH_HOME`，但必须保证任何 dsh 模块求值之前它已经是 boat 的值。
2. `boat/apps/cli/src/home.ts:34-50`：解析 `BOAT_HOME`（默认 `~/.boat`，空白视为未设置，`~` 展开），**无条件**写入 `DSH_HOME`。实测：同时设了 `DSH_HOME=x` 和 `BOAT_HOME=y`，`x` 下什么都不会生成，`profiles/`、`sessions/`、`storages/` 都出现在 `y` 下。
3. `boat/apps/cli/src/cli.ts:37-49`：`parseBoatArgs` 返回 `mode: 'profile'`，调 `runProfile`，同时传入 `loadLayeredEnv('boat')`（`dsh@rc.1:packages/boot/app-boot/src/index.ts:232`，读 `<cwd>/.env` 和 `$BOAT_HOME/.env`，只填未设置的变量，返回冻结快照）和 `pluginOverlay(...)`。
4. `boat/apps/cli/src/args.ts:109-118`：`run` 是透传命令（`passThrough`，84-90）。启动器只认 `--profile`（默认 `run`）、`--patch`、`--plugin`，其余 token 原样交给插件树。所以这里的 `args` 是 `--agents ./boat/agents --agent demo 看看资产`。启动器参数必须写在前面（`args.ts:4-10`）。

**B. 组合 profile**（`boat/apps/cli/src/profile-boot.ts`）

5. `runProfile`（194-253）先从环境装代理（196-199），再 `composeProfile`（161-172）。
6. `prepareProfile('run')`（138-143）→ `ensureProfileInitialized`（114-128）：`$BOAT_HOME/profiles/run/package.json` 不存在就按模板 `['@deepseek-ai/dsh-base','@boat/host','@boat/run']`（`templates.ts:17-20`）调 `initProfile`（`dsh@rc.1:packages/boot/app-boot/src/profile.ts:219`）；存在但 bundle 列表和模板不一致就报错退出。**为什么要报错**：老版本 boat 生成的 profile 可能少一个 bundle，悄悄照旧启动会缺服务。
7. `loadProfile`（`profile.ts:690`）→ `loadProfileDirectory`（642）对每个 bundle 做**bundle 准入**：`evaluatePluginCompatibility`（`dsh@rc.1:packages/boot/app-boot/src/plugin-compatibility.ts:61-88`）把 bundle 的 `@deepseek-ai/dsh*` peer 和 dsh-app-boot 自己的版本比，`workspace:*` 视为当前版本（76 行），不匹配就跳过这个 bundle 并在 stderr 说明。
8. 根 `$BOAT_HOME/profiles/run/cordis.yml` 每次都重写成 `[]`（`profile-boot.ts:94-98,141`）。**为什么**：整棵树只由 patch 层组成；Loader 的回写可能把组合后的行烤进根文件，下次启动就会重复。
9. `createRuntimeResolution`（`profile.ts:406`）从 `@boat/cli` 的依赖和 peer 广度优先收集包，给后面的裸包名解析用。这就是 `boat/apps/cli/package.json` 要列出所有 dsh 包的原因，也是 `CLAUDE.md:190` 要求“启动器的依赖闭包必须是 dsh 自己 `apps/cli` 的超集”的原因。
10. overlay 顺序是 `[...--patch 文件, ...--plugin 行]`（`profile-boot.ts:168-171`），`--plugin` 在最上面，用户文件盖不掉它。

**C. `boot()`**

11. 关闭流程：`createProcessShutdown`（最多 5 秒），SIGTERM 退出 0，SIGINT 退出 130（`profile-boot.ts:204-215`），`installFailLoud`（216-218）。
12. 组装 `profileContext`（223-233），`readProfilePatches`（`dsh@rc.1:packages/boot/app-boot/src/profile-context.ts:63-74`）按顺序排好层：bundle 层（dsh-base → `@boat/host` → `@boat/run`）→ profile 的 `cordis.patch.yml` → `$BOAT_HOME/cordis.patch.yml` → overlay；`DSH_TELEMETRY_DISABLED` 非空时再追加 `{id: 'session-telemetry-otel', disabled: true}`（52-55）。
13. `boot('boat', rootConfig, patches, prepare)`（`dsh@rc.1:packages/boot/app-boot/src/index.ts:970-1036`）：`new Context()`（977），`baseUrl` 设为 profile 目录（992），发布 `dshHomePath`（993），`ctx.plugin(Loader)`（999）。Loader 发布 `loader` 服务，并装上全局钩子：`internal/config`（每行在自己的 Context 里求 `!!js`）和 `internal/plugin`（合并行级 `inject`）（`dsh@rc.1:vendor/loader/src/index.ts:102-135`）。
14. `prepare(hostCtx)` 是 boat 的闭包（`profile-boot.ts:234-245`）：provide `profileContext` 和 `launchEnvironment`；`plugin(PluginPackages, {resolution})` 装一个内存解析器，让 profile 里的裸行名按安装的依赖表解析；`provideCmdline` 发布 `cmdlineArgs`、`appExit`、`appReady`（`dsh@rc.1:packages/boot/cmdline/src/index.ts:84`）。
15. `mountRootInclude`（`index.ts:536`，调用在 1002）：先跑 `prepareProfilePatches`（`dsh@rc.1:packages/boot/app-boot/src/compatibility-preflight.ts:180-187`）——**行准入**，只在 `profileContext` 存在时生效：把所有层应用到 `[]`，按每行包的 manifest 检查 dsh peer，不匹配的行改成 `disabled: true` 并打印原因，结果合成一个 `{insert: rows}`。然后 Include 读 `[]`、应用 patch、逐行 import 并 `registry.plugin`。
16. `await loader.await()`（1008），然后 `auditStartupEntries`（1010，实现在 923）：必须激活的 id 只有 `agent-loop`、`webserver`、`modules`、`connection`、`headless-runner`、`acp`、`sdk-jsonrpc-server`（744-752），其它没激活的只 warning。
17. 回到 `runProfile`：根 fiber 是 ACTIVE、`loader` 还在，就 `appReady.commit()`（`profile-boot.ts:246-251`）。`FIBER_STATE` 来自 `@boat/cordis-compat`。

**D. 行的激活**（顺序由服务可用性决定）

18. 内核行（都来自 dsh-base）：`llm`（`dsh@rc.1:packages/bundle/base/cordis.patch.yml:34-35`）、`session`（40-41）、`session-persistence-jsonl`（130-133，根目录 `dshHomePath('sessions')`）、`session-projection`（158-159）、`skill`（293-294）、`compaction-basic`（340-341）、`tools`（498-499）、`system-prompt`（503-506）、`agent-loop`（510-513，`agents: []`，所以它自己不建 agent）。`AgentLoop` 构造时注册 turnBoundary 和 inbox 两个投影、`ctx.agents.setFactory(this)`、加 `provider` / `model` / `cwd` 三个提示词变量（`dsh/core/agent-loop/src/index.ts:357-375`）。
19. `@boat/host` 的行（`boat/bundles/host/cordis.patch.yml:14-29`，下面按书写顺序列出，真实激活顺序看依赖）：`boatDistro` 和 `historyImport` 不注入任何服务，最先可用；`toolPolicy` 注入 tools、sessionProjections、systemPrompt，注册 `boatState` 投影和 `boat:state` context，挂 `boat/pre-assemble` 和 `tools/pre-execute`；`skillRouter` 多注入 skills、llm、toolPolicy，所以一定在 `toolPolicy` 之后，默认 `mode: off`（`skill-router/src/index.ts:77`）；`a2ui` 注入 tools、toolPolicy、sessionProjections。
20. `@boat/run` 的行（`boat/bundles/run/cordis.patch.yml:20-37`）：
    - `boat-run-startup` 注入 `cmdlineArgs`（`startup.ts:24`），用 commander 解析内层参数（`parseCmdline`，`dsh@rc.1:packages/boot/cmdline/src/index.ts:165`），`findAgentDirectory` 找第一个包含 `demo/agent.cordis.yml` 的 `--agents` 根（`agent-directory.ts:53-59`），provide `boatRunStartup = {task, preset: 'demo', agentDir, history}`（`startup.ts:92-94`）。用法错误时调 `appExit(code)`，什么也不发布。
    - `agent-preset-registry` 的行级 inject 满足后发布 `agentPresets`。
    - `boat-run` 的 `apply`（`boat/bundles/run/src/index.ts:247-254`）要求 `appExit` 存在，然后 `void run(...)`——**不等待**，所以 `boot()` 可以先返回。

**E. 创建 agent**（`boat/bundles/run/src/index.ts:184-240`）

21. `await ctx.get('loader')?.await()`（185）：等宿主树稳定；读 `agentDefaultModel.currentSelection()`（192）。
22. `declareAgent`（165-171）：`readAgentDefinition`（`agent-directory.ts:94-100`）把 `agent.cordis.yml` 读成 `PresetDefinition`；用 `ctx.extend({baseUrl: <agentDir>/})` 拿到的 `agentPresets` 调 `register`，放在 `ctx.effect` 里，所以声明和 `boat-run` 同生共死。`register` → `activate`（registry `index.ts:86-124`）：`createScope` 造出 **standing scope**，`mountPreset`（`mount.ts:258-272`）先对 4 行做和 profile 一样的准入（`prepareProfileEntries`），挂上，`auditRows` 审计，`leakedServices` 检查有没有行往根 realm 发布服务。
23. `presets.resolve('demo')`（198）；setup 闭包（200-204）：`installModelSelection` + `presets.mount(agentCtx, 'demo')`。
24. `agents.create({sessionId: 'session-<uuid>', meta: {cwd, agentPreset}, agentOptions: {provider, model}, setup})`（214-220）→ `AgentRegistry.create`（`dsh/core/agent/src/index.ts:391`）→ 工厂 `AgentLoop.createAgent`（`dsh/core/agent-loop/src/index.ts:717-754`）：
    1. `sessions.prepare(...)`（718）；
    2. `createStoredSession` → `sessionPersistence.create(header)`（682-690）拿到写 handle；JSONL 后端是惰性落地的，文件在第一次落盘时连同 header 一起写出（`dsh/session/session-persistence-jsonl/src/index.ts:241,314-332`，见 5.2）；
    3. `setupAndPublish`（757-783）→ `prepare` 在 owner 的 effect 里 `new ReactLoopAgent(...)`（579），构造函数造出 **agent scope**（`agent.ts:134`）；
    4. `setup(agent.ctx)`（778）：`presets.mount` 做 retain / bind / join，`bindScopeParent(agentKey, standingKey)`（registry `index.ts:233-257`）；
    5. `appendUnstoredSuffix`（780），然后 `publish`（617-629）：`sessions.enter`、`agents.enter`、`sessions.announce`、`agents.announce`（派发 `agent/created`）。
25. dsh-permission-presets 在 `session/created` 时追加 `permission/preset`、`sandbox/mode`、`approval/policy` 三条（`dsh@rc.1:packages/interaction/permission-presets/src/index.ts:241`），这就是每个日志开头的 seq 0–2。
26. `await agent.whenIdle()`，然后 `agent.followup(createUserMessage({content: [{type:'text', text: '看看资产'}], source: {kind: 'user'}}))`（221-228）。请求从这里开始，见第 4 节。

### 3.3 启动时能看到的真实输出

用一个 `--plugin` 探针（它只监听事件、往 stderr 打时间戳）跑上面的命令，得到：

```text
[t2 +0ms] trace row applied; fiber state=LOADING parent entry=plugin:.../trace2-plugin
[t2 +401ms] host loader settled
[t2 +426ms] agent/created session-2b1b1ecc-1c90-4e5a-a803-fb3c3bdc6e6e
[t2 +427ms] preset demo broken=- rows=[{"entryId":"persona","moduleName":"@deepseek-ai/dsh-persona","enabled":true,"fiberState":2},{"entryId":"boat-skill-router","moduleName":"@boat/skill-router/agent","enabled":true,"fiberState":2},{"entryId":"demo-tools","moduleName":"./lib/tools.js","enabled":true,"fiberState":2},{"entryId":"demo-hooks","moduleName":"./lib/hooks.js","enabled":true,"fiberState":2}]
[t2 +427ms] session header={"version":4,"id":"session-2b1b...","createdAt":1790183770706,"cwd":".../workspace","isSeeded":false,"agentPreset":"demo"}
```

另一个探针列出了根 realm 的服务：宿主树稳定后 65 个，agent 创建之后还是 65 个——demo 的 4 行没有往根 realm 漏任何服务。`config dump --profile run` 显示 100 行；运行时探针统计到其中 7 行禁用：`tool-plugin-manager`、`pwsh-sandbox`、`tool-pwsh`、`skill-badge`、`tool-ralph`（dsh-base 自己禁的；pwsh 两行是在非 Windows 上按平台禁用，`dsh@rc.1:packages/bundle/base/cordis.patch.yml:240-242,270-272`，在 Windows 上换成 `bash-sandbox`、`tool-bash` 被禁，236、268 行）、`hmr`（`@boat/run` 禁的）、`session-telemetry-otel`（遥测开关；`config dump` 不显示这一层，见 [7.4](#74-已知的坑)）。

探针代码（去掉了无关部分），也是一个“`--plugin` 能做什么”的例子：

```js
export const name = 'boat-trace2'
export function apply(ctx) {
  const t0 = performance.now()
  const out = (s) => process.stderr.write(`[t2 +${(performance.now() - t0).toFixed(0)}ms] ${s}\n`)
  void (async () => { await ctx.root.get('loader')?.await(); out('host loader settled') })()
  ctx.on('agent/created', ({ agent }) => out(`agent/created ${agent.id}`))
  ctx.on('boat/intake', async (payload, next) => { const d = await next(); out(`boat/intake -> ${d.kind}`); return d })
}
```

它不注入任何服务，所以 Include 一处理到它就 apply（`fiber state=LOADING`），比宿主树稳定早 400 ms。再用一个只打印“apply 时哪些服务已存在”的探针，配合 `distro-aware.mjs`（它用拒识门直接回答，不需要模型）跑一次：

```console
$ node boat/apps/cli/lib/bin.js run --plugin ./probe.mjs --plugin boat/bundles/run/tests/fixtures/plugins/distro-aware.mjs "hi"
[probe] apply: agentPresets=false toolPolicy=false llm=false boatRunStartup=false
[probe] settled: agentPresets=true toolPolicy=true llm=true
boat on dsh 0.1.7-rc.1: agent-loop-intake, agent-loop-pre-assemble
```

`--plugin` 行排在所有 patch 层的最后，可它 apply 的时候连 `llm` 都还没有——这就是“激活顺序由服务可用性决定、和行顺序无关”的实证。

**`boat web` 的差别**：`web` profile 的模板是 `[dsh-base, @boat/host, @deepseek-ai/dsh-web-app]`（`templates.ts:21-23`），走同一个 `runProfile`。`hmr` 在这里是开的（dsh-base 里它的 `disabled` 表达式是 `!ctx.get('profileContext')`，`dsh@rc.1:packages/bundle/base/cordis.patch.yml:28-32`），会监视 patch 文件热重组。实测组合出 182 行、29 行禁用、根 realm 90 个服务（另有 `compaction`、`planMode`、`terminals`、`toolResultPruner`、`workflowEngine` 在 `isolate` 的私有 realm 里各有实例；把所有 realm 的服务存储项都算上是 102 个——`run` 组合没有 isolate 行，三种数法都是 65），boat 的 5 个宿主服务都在；但 web profile 提供的是 dsh-web-app 自带的 preset（standard、ptc、minimal、cordis），**不会加载 `boat/agents/*`**——目前只有 `@boat/run` 会声明 agent 目录。

### 3.4 启动保证哪些能力

常见的问题是：llm、tools、skill、session、memory 是不是每次启动都一定初始化好了？在 ark 里答案由 `BaseAgent` 的 `build_*` 方法决定；在 dsh 里答案取决于“谁注入它”和“谁在启动审计的名单上”。

- 启动审计 `auditStartupEntries` 只对 7 个固定 id 强制“必须激活”（`dsh@rc.1:packages/boot/app-boot/src/index.ts:744-752`），`run` 组合里只有 `agent-loop` 在名单上。
- 所以硬保证的是 `AgentLoop.inject` 的 6 个服务：`agents`、`sessions`、`llm`、`tools`、`systemPrompt`、`sessionProjections`（`dsh/core/agent-loop/src/index.ts:334`）。缺一个，`agent-loop` 停在 PENDING，审计抛 `StartupError`。
- 其它服务缺了，依赖它的行停在 PENDING，启动只打 warning。

我们用 `--patch` 每次禁一行做了实验（patch 文件放在仓库外、传绝对路径；运行方式见 [7.5](#75-复现本文的运行) 的 `repro.mjs`）：

```yaml
# /tmp/no-skill.yml
- id: skill
  disabled: true
```

| 禁掉的行 | 参数 | 结果（stderr 摘录） | 退出码 | 原因 |
|---|---|---|---|---|
| `llm` | `run --patch /tmp/no-llm.yml 你好` | `boat: no agent factory registered (load an agent-loop plugin)`，然后 `StartupError: boat: startup failed: 1 required plugin did not activate`，`Plugins waiting for services (8)`，第一行是 `agent-loop (required)  llm`（其余是连带等待的行） | 1 | `agent-loop` 注入 `llm`；第一句来自 `boat-run` 调 `agents.create` 时还没有工厂（`dsh/core/agent/src/index.ts:206`） |
| `tools` | `run --patch /tmp/no-tools.yml 你好` | 同样的 `StartupError`，`Plugins waiting for services (22)`，第一行 `agent-loop (required)  tools` | 1 | 同上 |
| `session` | `run --patch /tmp/no-session.yml 你好` | 同样的 `StartupError`，`Plugins waiting for services (13)`，第一行 `agent-loop (required)  sessions` | 1 | 同上 |
| `skill` | `run --patch /tmp/no-skill.yml 你好` | `boat: warning: 3 entries did not activate`：`skill-filesystem`、`tool-skill`、`boat-skill-router` 都是 `pending (waiting for service: skills)`；照常回答 | 0 | 没有被强制的行注入 `skills` |
| `skill` | `run --patch /tmp/no-skill.yml --agents <abs>/boat/agents --agent demo 看看资产` | 同样 3 行 warning，然后 `boat: boat-skill-router (@boat/skill-router/agent): waiting for skillRouter` 和 `demo-tools (./lib/tools.js): waiting for skills` | 1 | demo 的 preset 挂载审计发现两行等不到服务，preset 标为 broken；`presets.mount` 抛 `agent-preset/invalid`（`dsh@rc.1:packages/preset/agent-preset-registry/src/index.ts:221-227`），`boat-run` 打印原因并退出 1（`boat/bundles/run/src/index.ts:173-176,253`） |
| `session-persistence-jsonl` | `run --patch /tmp/no-persistence.yml 你好` | `session-checkpoint-policy ... pending (waiting for service: sessionPersistence)`；照常回答，但 `$BOAT_HOME/sessions` 下**没有任何日志** | 0 | `AgentLoop` 只用 `ctx.get('sessionPersistence')` 可选地取后端（`dsh/core/agent-loop/src/index.ts:682-690`），没有就只在内存里 |
| `boat-history-import` | 见 [2.3](#23-dsh-与-boat-的-di-怎么交互) 例子 3 | `boat-run (@boat/run): pending (waiting for service: historyImport)`，进程挂住 | 124（被 `timeout` 杀掉） | `boat-run` 静态注入 `historyImport`，但不在审计名单上 |
| memory | — | 没有可禁的行：dsh `0.1.7-rc.1` 没有 memory 包，也没有 memory 服务 | — | 见 [0.4](#04-给-ark-agentic-工程师的对照) |

结论：

- **硬保证**：`llm`、`tools`、`sessions`（连同 `systemPrompt`、`sessionProjections`、`agents`）。缺一个，进程直接失败退出，不会带病运行。
- **按 agent 保证**：`skills`。没人用时照常跑；某个 agent 的行注入了 `skills`，那个 agent 的 preset 就失效，`boat run --agent` 退出 1。
- **不保证**：会话日志落盘。持久化后端缺了，`boat run` 照样成功，只是没有日志。“日志是唯一事实来源”目前是约定，不是启动检查。
- **会挂住的**：boat 自己的宿主服务（`historyImport` 等）缺了时 `boat-run` 等不到服务，也不会被审计判失败，见 [7.4](#74-已知的坑)。
- **没有的**：memory。

---

## 4. 一次请求的流程

### 4.1 harness 收到任何一个请求时做什么

```mermaid
flowchart TB
  msg["消息进入<br/>followup 进 next-turn 或 steer 进 next-step"] --> ins["inbox.splice<br/>append agent/inbox/spliced · emit agent/inbox/inserted"]
  ins --> wake["唤醒 driver<br/>emit agent/status running"]
  wake --> ts["append turn/start"]
  ts --> claim["inbox.claim<br/>append agent/inbox/spliced · emit agent/inbox/claimed"]
  claim --> intake{"boat/intake<br/>waterfall，默认 pass"}
  intake -->|"reply"| reply["replyStep<br/>step/start · 空的 system/message · user/message<br/>assistant/message provider=boat · step/end"]
  intake -->|"pass"| pre["boat/pre-assemble<br/>waterfall：skill-router 路由与激活，tool-policy 对齐可见性"]
  pre --> asm["systemPrompt.assemble<br/>sections · contexts · 可见工具"]
  asm --> pstep["agent/pre-step<br/>waterfall：压缩、检查点 flush、AGENTS.md 指令<br/>skill catalog、plan-mode、重复工具提醒、模型选择"]
  pstep --> sst["append step/start"]
  sst --> req["agent/request waterfall · llm.prepareCall<br/>append system/message · user/message · request/header · request/context"]
  req --> strm["llm/stream waterfall<br/>emit agent/assistant-stream，不落盘"]
  strm -->|"流正常结束"| am["append assistant/message"]
  strm -->|"出错或中止"| rerr["append assistant/attempt<br/>agent/request-error waterfall<br/>llm-retry 决定是否重试"]
  rerr -->|"retry"| req
  rerr -->|"不重试"| err["抛 LlmError · append step/end<br/>emit agent/error · append turn/end kind=error"]
  am --> hasTool{"有 tool-call"}
  hasTool -->|"没有"| send["append step/end"]
  hasTool -->|"有"| tools["每个调用：append tool/call<br/>tools/pre-execute · tools/execute · tools/post-execute<br/>emit tools/result · append tool/result"]
  tools --> send
  send --> done{"turn 结束且 next-step 为空"}
  done -->|"否"| claim
  done -->|"是"| stop["agent/turn-stopping serial<br/>append turn/end"]
  reply --> stop
  stop --> idle["driver 回到 idle<br/>emit agent/status idle"]
  err --> idle
```

每一次 `Session.append` 都会触发 `session/event`，投影注册表在这时跑所有投影的 `apply`（`dsh/session/session-projection/src/index.ts:220-221,657`），JSONL 后端把事件放进写缓冲（`dsh/session/session-persistence-jsonl/src/storage.ts:274-282,535`）。图里没有画这两条线，因为它们挂在每一个 append 上。

| 阶段 | 事件 | 派发方式 | 代码 | boat 在这里做什么 |
|---|---|---|---|---|
| S1 入 inbox | `agent/inbox/inserted` | emit | `dsh/core/agent-loop/src/inbox.ts:235-240` | — |
| S2 开 turn | — | — | `agent.ts:323` 追加 `turn/start` | — |
| S3 领取 | `agent/inbox/claimed` | emit | `inbox.ts:109-112` | — |
| S4 拒识门 | `boat/intake` | waterfall | `agent.ts:279-284` | demo-hooks 命中“炒股 / 股票…”就返回 reply（`boat/agents/demo/src/hooks.ts:12-26`） |
| S5 组装前 | `boat/pre-assemble` | waterfall | `agent.ts:285-288` | skill-router 在 `next()` 前路由（`skill-router/src/index.ts:181-184`）；tool-policy 在 `next()` 后对齐（`tool-policy/src/index.ts:120-123`） |
| S6 组装 | `system-prompt/assemble` | waterfall | `agent.ts:290`；`dsh/core/system-prompt/src/index.ts:558,626` | boat 不监听，只通过 `section` / `context` 注册内容 |
| S7 进入前 | `agent/pre-step` | waterfall | `agent.ts:294-300` | boat 不监听。run 组合里挂在这里的 dsh 监听：compaction-basic（压缩，`dsh/compaction/compaction-basic/src/index.ts:158`）、session-checkpoint-policy（flush）、agent-instructions（AGENTS.md 类指令，`dsh@rc.1:packages/context/agent-instructions/src/index.ts:315`）、tool-skill（skill catalog）、plan-mode、repeat-tool-reminder、goal-round-driver，以及 `boat-run` 通过 `installModelSelection` 装的模型选择 |
| S8–S11 请求 | `agent/request`、`llm/stream` | waterfall | `agent.ts:643,503`；`dsh/llm/llm/src/index.ts:73,1122` | — |
| S11′ 请求失败 | `agent/request-error` | waterfall，默认不重试 | `agent.ts:555-575`（先追加 `assistant/attempt`） | — （llm-retry 在这里返回 `{kind: 'retry'}`，`dsh@rc.1:packages/llm/llm-retry/src/index.ts:243`） |
| S12 流 | `agent/assistant-stream` | emit，不持久化 | `agent.ts:499` | `boat run` 把推理打到 stderr（`boat/bundles/run/src/index.ts:107-155`） |
| S13 工具 | `tools/pre-execute`、`tools/execute`、`tools/post-execute`、`tools/result` | waterfall ×3、emit | `dsh/core/tools/src/index.ts:1505,1605,1781,1703` | tool-policy 对需确认的工具返回 `ask`（124-131）；工具的 `presentationMeta` 带出 `meta.boat`；skill-router 监听 `tools/result` 处理模型自己调 `skill` 工具 |
| S14 结束 | `agent/turn-stopping` | serial | `agent.ts:385` | — |

**几个要点，每个都容易想错：**

- **`boat/intake` 和 `boat/pre-assemble` 每个 step 都派发**，不只是第一个。工具结果之后的 step 里 `messages` 是 `[]`，监听要能处理空数组；skill-router 看到没有用户文字就不路由（`skill-router/src/index.ts:265-267`）。
- **拒识门在路由之前**。reply 分支不组装提示词、不调模型，也就没有路由调用。
- **`boat:state`（order 130）和 `boat:skill`（140）是 runtime context，不是系统提示 section**。它们和 dsh 的 `sandbox:policy`（110）、`approval:policy`（115）一起渲染成一条 `source.kind = 'runtime-context'` 的 **user** 消息：快照消息由 `RuntimeContextProjection.project` 构造（`dsh/core/agent-loop/src/runtime-context.ts:150-163`），放在领取的用户消息之后则是 `agent/pre-step` 的默认决定 `messages: [...claimed, context]`（`dsh/core/agent-loop/src/agent.ts:293-299`）。只有 full 模式的 `boat:skills`（450）是系统提示 section（`skill-router/src/index.ts:51-54`）。
- **state delta 和卡片不是在 `tools/post-execute` 里加的**。它们在 dispatch 阶段由 `createSuccessResult` 调工具的 `presentationMeta` 产生，只对顶层调用生效（`dsh/core/tools/src/index.ts:1843`），然后 agent-loop 原样写进 `tool/result.meta`（`dsh/core/agent-loop/src/tool-calls.ts:282-289`）。boat 没有 `tools/post-execute` 监听。
- **state 在下一个 step 才被模型看到**：`boatState` 投影在 `tool/result` 追加时就更新了，但 runtime context 在下一次 `assemble` 时才重新渲染。
- **`step/start` 在 `system/message` 之前**：先 `step/start`（`agent.ts:371`），再 `prepareRequest`，然后才追加 `system/message` 和本 step 的 `user/message`（476-490），最后 `request/header`（683-694）。

### 4.2 demo 请求“看看资产”的时序

```mermaid
sequenceDiagram
  autonumber
  participant RUN as boat-run
  participant AG as ReactLoopAgent
  participant HK as demo-hooks
  participant TP as toolPolicy
  participant SR as skillRouter
  participant SP as systemPrompt
  participant LLM as llm + DeepSeek 适配器
  participant TR as tools 运行时
  participant DT as asset_overview
  participant SES as Session + 投影
  RUN->>AG: followup 看看资产
  AG->>SES: append agent/inbox/spliced, turn/start, agent/inbox/spliced
  AG->>HK: boat/intake waterfall, 只有 demo-hooks 监听
  HK-->>AG: 没命中拒识词, next 返回默认 pass
  AG->>TP: boat/pre-assemble waterfall
  TP->>SR: next, tool-policy 在外层
  SR->>LLM: llm.stream 旁路路由调用, llm/stream waterfall
  LLM-->>SR: skill_id asset-overview, reason 观察类
  SR->>SES: append boat/route-request
  SR->>SES: append boat/skill-routed, 投影 boatActiveSkill 更新
  SR->>TP: clear 然后 activate asset_overview
  SR-->>TP: next 返回
  TP->>TP: reconcile, 未激活的 auto 工具 diagnose_assets 进 deny, tools.restrict
  AG->>SP: assemble, contexts 含 boat:skill
  AG->>AG: agent/pre-step waterfall, 检查点 flush, skill catalog
  AG->>SES: append step/start, system/message, user/message x3
  AG->>SES: append request/header 25 个工具, request/context
  AG->>LLM: llm/stream 循环请求
  LLM-->>AG: tool-call asset_overview
  AG->>SES: append assistant/message, tool/call
  AG->>TR: tools/pre-execute waterfall, 结果 allow
  TR->>TR: tools/execute waterfall, 检查点 flush
  TR->>DT: execute
  DT->>DT: a2ui.render 出卡, 组装 stateDelta
  DT-->>TR: 返回值, render 成 digest, presentationMeta 带 meta.boat
  TR->>TR: tools/post-execute waterfall, emit tools/result
  AG->>SES: append tool/result 含 meta.boat.card 与 stateDelta
  SES->>SES: boatState 与 boatCards 折叠
  AG->>SES: append step/end, step/start
  AG->>HK: 第 2 步 boat/intake, messages 为空, pass
  AG->>TP: 第 2 步 boat/pre-assemble, 没有用户文字不路由, 只 refreshActive
  AG->>SP: assemble, contexts 多了 boat:state
  AG->>SES: append user/message runtime-context
  AG->>LLM: llm/stream 第 2 次循环请求
  LLM-->>AG: 文本 您的资产总览已生成
  AG->>SES: append assistant/message, step/end
  AG->>AG: agent/turn-stopping serial
  AG->>SES: append turn/end completed
  RUN->>SES: sessions.flush, 打印答案, appExit 0
```

脚本化模型一共收到 4 个请求，顺序是：路由、循环（25 个工具）、标题、循环。第一次循环请求里有 `asset_overview`、没有 `diagnose_assets`——因为只有被激活的 skill 的 `requiredTools` 会被放开（`boat/agents/demo/skills/asset-overview/SKILL.md` 的 frontmatter：`metadata.boat.requiredTools: [asset_overview]`）。标题请求来自 dsh 的 `session-title` 和 `session-title-llm` 行（包 `dsh-session-title-first-prompt-llm`），它们等第一条 `request/header` 写入、拿到主请求的路由后才启动（`dsh@rc.1:packages/session/session-title/src/index.ts:356-363,526-536`），和 boat 无关。

**为什么路由要在 `boat/pre-assemble` 里做、而不能挂在 dsh 的 `agent/pre-step` 上**：`agent/pre-step` 在 `systemPrompt.assemble` 之后才派发（`agent.ts:290-300`），那时提示词和可见工具已经定了；路由的结果（skill 正文、`requiredTools`）必须影响**这一步**的请求。这正是 `extensions.yml:40-48` 写的理由和退出条件。

---

## 5. 会话日志的时序

### 5.1 日志在哪、长什么样

- **路径**：`$BOAT_HOME/sessions/<编码后的 cwd>/session-<uuid>/session.v4.jsonl.zstd`，旁边一个锁文件 `session.lock`。日志路径由 `logPath` 拼出（`dsh/session/session-persistence-jsonl/src/format.ts:298-305`），锁文件名是 `LEASE_FILENAME`（`dsh/session/session-persistence-jsonl/src/lease.ts:40`）。根目录来自 dsh-base 的 `root: !!js dshHomePath('sessions')`（`dsh@rc.1:packages/bundle/base/cordis.patch.yml:130-133`），而 `dshHomePath` 读的是被 boat 改写过的 `DSH_HOME`，所以日志总在 `$BOAT_HOME` 下。
- **格式**：zstd 压缩，**每次落盘写一个 zstd 帧**；第一行是 header：

```json
{"type":"session","version":4,"id":"session-b57a00dd-5133-498a-814d-872911a50c2d","createdAt":1790184018258,"cwd":".../workspace","isSeeded":false,"delegationDepth":0,"agentPreset":"demo"}
```

- **读法**：`@boat/testing/session-log` 的 `findSessionLogs(home)` / `readSessionLog(path)`（`boat/tooling/testing/src/session-log.ts:113-132`）。它逐帧解压：JSONL 后端每批写一个 zstd 帧，而 Node 的 `zstdDecompressSync` 读完第一帧就停，所以要先用 `scanZstdFrames` 按结构找出每一帧，再逐帧解码（模块说明 `session-log.ts:7-10`，实现 `38-101`）。
- **同时写的**：`$BOAT_HOME/storages/session_projcache/sessions/<id>.json`（投影缓存）。

### 5.2 追加与落盘的时序

事件什么时候**追加**（进内存日志）和什么时候**落盘**（写 zstd 帧）是两回事：

1. `Session.append`（`dsh/core/session/src/index.ts:720-765`）校验数据，推进内存日志，然后派发 `session/event`。
2. JSONL 后端的 tracker 收到 `session/event` 就 `enqueueLive`：拷一份进缓冲，挂一个 200 ms 的定时器（`storage.ts:36,274-282`）。
3. `session/flush` 让缓冲立刻排空。按约定它只通过 `sessions.flush(session)` 派发（`dsh/core/session/src/index.ts:1176-1193`）——这是 docstring 里写的约定（1163-1175：一个入口、一种写法，便于不变式检查），不是技术限制，代码并不阻止别人直接 `ctx.parallel('session/flush', …)`；`drainBuffered`（`storage.ts:294`）是单飞循环，写的过程中新到的事件进下一批。
4. 实际写：第一次落盘由 `materialize`（`dsh/session/session-persistence-jsonl/src/index.ts:1176`）把 header 帧和第一批帧写进临时文件、fsync 后发布；之后每批追加一个 zstd 帧，`open(path,'a')` → `writeFile` → `sync()`，失败就截回原长度（1357）。

在我们跑的四次 `boat run` 里，**每一次写入都来自显式 flush 或关闭时的排空，没有一次是那个 200 ms 定时器触发的**：

| 触发者 | 时机 | 代码 |
|---|---|---|
| `dsh-session-checkpoint-policy` | 任何带 `sessionId` 的 `llm/stream`（循环、路由、标题）开始前；顶层 `tools/execute` 执行工具体之前；每个 `agent/pre-step` | `dsh@rc.1:packages/session/session-checkpoint-policy/src/index.ts:63-83` |
| `dsh-session-projection-cache` | 写检查点时调 `sessions.flush`：`session/created`、`turn/end` 以及事件数 / 时间阈值 | `dsh@rc.1:packages/session/session-projection-cache/src/index.ts:266,316-317,337-338`；dsh-base 的行配置 `cordis.patch.yml:182-186` |
| `@boat/run` | `whenIdle` 之后 `await sessions.flush(agent.session)`。在我们的运行里它总比投影缓存的 `turn/end` 检查点晚约 2 ms，并入同一次排空，没有单独写出过帧 | `boat/bundles/run/src/index.ts:233` |
| 关闭 | `session/disposed` 时关闭 handle，先排空剩余 | `storage.ts:548` |

```mermaid
sequenceDiagram
  autonumber
  participant AG as driver 与 skill-router
  participant TT as session-title 插件
  participant SES as Session.append
  participant PRJ as sessionProjections
  participant CK as checkpoint-policy
  participant PC as projection-cache
  participant JH as JSONL handle
  participant F as session.v4.jsonl.zstd
  Note over AG,F: agent 创建
  AG->>JH: sessionPersistence.create(header), 此时还没有文件
  SES->>SES: permission-presets 在 session/created 时追加 seq 0-2
  PC->>JH: session/created 时 flush
  JH->>F: 首次落盘创建文件, 帧 0 header, 帧 1 seq 0-2
  Note over AG,F: turn 1 step 1
  AG->>SES: inbox 插入, turn/start, inbox 领取 seq 3-5
  SES->>PRJ: session/event, inbox 与 turnBoundary 折叠
  AG->>CK: 路由调用 llm/stream 带 sessionId
  CK->>JH: flush
  JH->>F: 帧 2 seq 3-5
  AG->>SES: boat/route-request, boat/skill-routed seq 6-7
  SES->>PRJ: boatActiveSkill 变为 asset-overview
  AG->>CK: agent/pre-step
  CK->>JH: flush
  JH->>F: 帧 3 seq 6-7
  AG->>SES: step/start 到 request/context seq 8-14
  AG->>CK: 循环请求 llm/stream
  CK->>JH: flush
  JH->>F: 帧 4 seq 8-14
  TT->>SES: session/title fallback, title-llm-request seq 15-16
  TT->>CK: 标题请求 llm/stream
  CK->>JH: flush
  JH->>F: 帧 5 seq 15-16
  AG->>SES: assistant/message, tool/call seq 17-18
  AG->>CK: tools/execute 执行工具体之前
  CK->>JH: flush
  JH->>F: 帧 6 seq 17-18
  TT->>SES: provider 标题 seq 19
  JH->>F: 帧 7 seq 19, 推断为帧 6 写入期间到达, 由同一排空循环写下
  AG->>SES: tool/result, step/end seq 20-21
  SES->>PRJ: boatState 与 boatCards 折叠
  Note over AG,F: turn 1 step 2
  AG->>CK: agent/pre-step
  CK->>JH: flush
  JH->>F: 帧 8 seq 20-21
  AG->>SES: step/start, runtime-context seq 22-23
  AG->>CK: 第 2 次循环 llm/stream
  CK->>JH: flush
  JH->>F: 帧 9 seq 22-23
  AG->>SES: assistant/message, step/end, turn/end seq 24-26
  PC->>JH: turn/end 时 flush, 投影缓存检查点
  JH->>F: 帧 10 seq 24-26
  Note over AG,JH: boat-run 随后的 sessions.flush 并入同一次排空, 不产生新帧
```

同一次运行的完整事件表（时间是相对 seq 0 的毫秒数，帧号来自逐帧解码）：

| seq | +ms | 类型 | 关键字段 | 帧 |
|---|---|---|---|---|
| 0 | 0 | `permission/preset` | `preset: workspace-write` | 1 |
| 1 | 2 | `sandbox/mode` | `mode: workspace-write` | 1 |
| 2 | 2 | `approval/policy` | `policy: ask` | 1 |
| 3 | 6 | `agent/inbox/spliced` | `target: next-turn`，插入用户消息 | 2 |
| 4 | 7 | `turn/start` | `turn: 1` | 2 |
| 5 | 8 | `agent/inbox/spliced` | `removedCount: 1`（driver 领取） | 2 |
| 6 | 133 | `boat/route-request` | 候选 `[asset-diagnosis, asset-overview]`，决定 `asset-overview`，`durationMs: 59` | 3 |
| 7 | 148 | `boat/skill-routed` | `skill: asset-overview`，`source: router` | 3 |
| 8 | 172 | `step/start` | turn 1 step 1 | 4 |
| 9 | 175 | `system/message` | `surfaceOp: append`，约 4.2k 字符（含 demo persona，随 cwd 长度变化） | 4 |
| 10 | 175 | `user/message` | `source.kind: user`，“看看资产” | 4 |
| 11 | 177 | `user/message` | runtime-context：`sandbox:policy`、`approval:policy`、`boat:skill` | 4 |
| 12 | 178 | `user/message` | `source.kind: skill-catalog` | 4 |
| 13 | 180 | `request/header` | `reason: initial`，25 个工具，含 `asset_overview` | 4 |
| 14 | 181 | `request/context` | provider、`contextWindow`、`systemPromptUpdate: in-history` | 4 |
| 15 | 184 | `session/title` | `source.kind: fallback` | 5 |
| 16 | 185 | `session/title-llm-request` | 完整的标题请求 | 5 |
| 17 | 213 | `assistant/message` | `tool-call asset_overview`，`id: call-overview` | 6 |
| 18 | 215 | `tool/call` | `name: asset_overview`，`arguments: "{}"` | 6 |
| 19 | 225 | `session/title` | provider 生成的标题 | 7 |
| 20 | 263 | `tool/result` | `isError: false`，`meta.boat.card` + `meta.boat.stateDelta`，`sourceEventSeqs: [18]` | 8 |
| 21 | 264 | `step/end` | | 8 |
| 22 | 295 | `step/start` | turn 1 step 2 | 9 |
| 23 | 296 | `user/message` | runtime-context：`sandbox:policy`、`approval:policy`、**`boat:state`**、`boat:skill` | 9 |
| 24 | 308 | `assistant/message` | “您的资产总览已生成（DEMO-OK）。” | 10 |
| 25 | 308 | `step/end` | | 10 |
| 26 | 315 | `turn/end` | `reason: {kind: completed}` | 10 |

几个观察：step 2 没有第二条 `request/header`（头没变、也没开新请求序列，`agent.ts:683-694`）；`request/context` 只在值变化时追加（705-711）；路由调用本身 59 ms，seq 5 到 seq 6 之间的 125 ms 还包括取 skill 快照和 flush。

### 5.3 真实 JSONL 片段（裁剪过）

```jsonl
{"type":"boat/route-request","seq":6,"time":1790184018399,"data":{"turn":1,"route":{"provider":"deepseek-official","model":"<model>"},"candidates":["asset-diagnosis","asset-overview"],"decision":"asset-overview","reason":"观察类","durationMs":59}}
{"type":"boat/skill-routed","seq":7,"time":1790184018414,"data":{"turn":1,"skill":"asset-overview","reason":"观察类","source":"router"}}
{"type":"user/message","seq":11,"time":1790184018443,"data":{"content":[{"type":"text","text":"Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurr…(1212)"}],"source":{"kind":"runtime-context","form":"snapshot","sections":[{"name":"sandbox:policy","text":"Current DSH file policy: workspace-write. …(312)"},{"name":"approval:policy","text":"Approval policy: ask. …(153)"},{"name":"boat:skill","text":"The following skill is active for the current task. Follow its instructions.\n<skill_conten…(657)"}]},"role":"user","id":"cdf2c0d3-…"},"surfaceOp":"append"}
{"type":"request/header","seq":13,"time":1790184018446,"data":{"header":{"config":{"provider":"deepseek-official","model":"<model>","maxTokens":256000,"reasoningEffort":"high"},"adapterDefaults":{"reasoningEffort":true,"maxTokens":true},"tools":"<25 tools: asset_overview,bash,create_goal,…>"},"reason":"initial"}}
{"type":"assistant/message","seq":17,"time":1790184018479,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"tool-call","id":"call-overview","name":"asset_overview","arguments":"{}"}],"source":{"kind":"model","provider":"deepseek-official","model":"<model>","replayState":{…}},"id":"05913f00-…"},"usage":{"inputTokens":3,"outputTokens":2,"totalTokens":5},"stream":"<6 stream frames>"},"surfaceOp":"append"}
{"type":"tool/call","seq":18,"time":1790184018481,"data":{"turn":1,"step":1,"callId":"call-overview","name":"asset_overview","arguments":"{}"}}
{"type":"tool/result","seq":20,"time":1790184018529,"data":{"turn":1,"step":1,"message":{"role":"tool","source":{"kind":"tool","callId":"call-overview"},"toolCallId":"call-overview","content":[{"type":"text","text":"status=ok · [卡片:资产/full] 总额300,000.00元（约30.00万元） · 保单4份 · 已授权3/3桶 · 卡后一句简短收尾（≤25字），不复述卡内数字"}],"isError":false,"id":"64fc0150-…"},"meta":{"boat":{"card":{"surfaceId":"asset_overview-session--7df8fc","payload":{"event":"beginRendering","version":"1.0.0","surfaceId":"asset_overview-session--7df8fc","rootComponentId":"root-container","showType":"card","components":"<14 components>"}},"stateDelta":{"yl_assets":{"total":"300000.00","buckets":{"日常":{"pct":15,…},"稳健":{"pct":58,…},"进取":{"pct":27,…}},"policy_count":4,"auth_state":"full",…},"yl_assets_raw":{"accounts":[…3 accounts…]}}}}},"sourceEventSeqs":[18],"surfaceOp":"append"}
{"type":"user/message","seq":23,"time":1790184018562,"data":{"content":[{"type":"text","text":"Current runtime context. …(2033)"}],"source":{"kind":"runtime-context","form":"snapshot","sections":[…,{"name":"boat:state","text":"Session state, accumulated from tool results (JSON):\n{\"yl_assets\":{\"total\":\"300000.00\",…(819)"},{"name":"boat:skill",…}]},"role":"user","id":"bb2535e6-…"},"surfaceOp":"append"}
{"type":"turn/end","seq":26,"time":1790184018581,"data":{"turn":1,"reason":{"kind":"completed"}}}
```

boat 的事实都骑在 dsh 已有的信封上：

| boat 的事实 | 在日志的哪里 | 谁写的 | 谁读 |
|---|---|---|---|
| 卡片 | `tool/result.data.meta.boat.card` | demo 工具的 `presentationMeta`（`boat/agents/demo/src/tools.ts:57-59`） | `boatCards` 投影（`boat/plugins/a2ui/src/index.ts:101-113`） |
| 状态增量 | `tool/result.data.meta.boat.stateDelta` | `toolPolicy.register` 包一层 `presentationMeta`（`boat/plugins/tool-policy/src/index.ts:74-92`） | `boatState` 投影（`boat/plugins/tool-policy/src/state.ts:78-98`），再由 `boat:state` context 渲染（`state.ts:101-104`） |
| 当前 skill | `boat/skill-routed` | skill-router（`skill-router/src/index.ts:390`） | `boatActiveSkill` 投影（118-127） |
| 路由审计 | `boat/route-request` | skill-router（322-324） | 人 |
| 拒识回复 | `assistant/message.message.source = {provider: 'boat', model: <插件名>}` | driver 的 `replyStep`（`agent.ts:450-458`） | 人、UI |

### 5.4 日志怎么映射回模型看到的内容

**规则：模型看得到的，日志里都能还原**（`CLAUDE.md:76`，dsh 的规则）。driver 发请求时不是自己拼消息，而是追加 `request/header` / `request/context` 之后，直接用 `session.deriveMessages()` 当消息列表（`agent.ts:716-729`）。`deriveMessages`（`dsh/core/session/src/index.ts:842`）只遍历带 `surfaceOp` 的事件；对 `tool/result` 只取 `data.message`（`dsh/core/session/src/surface.ts:150-151`）。所以：

- `meta.boat.card` 和 `stateDelta` **永远不进对话记录**，模型看到的是工具 `render` 出来的 digest（`tools.ts:56`：`status=ok · …`）。卡片只给 UI。
- 状态进模型的唯一路径是下一步的 `boat:state` runtime context（seq 23）。

dsh 在测试里用一条不变式强制这件事：每个循环请求的 `messages` 必须等于派发时的 `deriveMessages()`，模型、工具等必须等于折叠后的 `request/header`（`dsh/core/agent-loop/src/invariant.ts:21-56`）。这条不变式挂在 `invariants` 服务上，`boat run` 的组合里没有这个服务，它在单元测试 harness 和 G2 里生效（`CLAUDE.md:167-168`）。对上面这次真实运行，我们离线用内核的 `Session.create(id, 回复前的事件)`（`dsh/core/session/src/index.ts:505`）`.deriveMessages()` 逐个重建循环请求，再和脚本化模型收到的请求比较（脚本是 [7.5](#75-复现本文的运行) 的 `check-log.mjs`，它输出 `loop #1: ... system equal=true  blocks equal=true (3)  tools equal=true (25)`）：

| 请求 | 推导出的消息 | 线上请求 | 系统文本 | 各块文本 | 工具 vs `request/header` |
|---|---|---|---|---|---|
| 循环 #1 | system、user、runtime-context、skill-catalog | `system` + 1 条 user（3 个 text 块），25 个工具 | 相同 | 相同（3 块） | 相同（seq 13） |
| 循环 #2 | 上面 + assistant(tool-call)、tool、runtime-context | 3 条消息：user(3 text)、assistant(tool_use)、user(tool_result + text) | 相同 | 相同（6 块） | 相同（seq 13） |

DeepSeek 适配器在线上做了四件事：

1. 把 surface 第 0 个节点（`system/message`）挪到 `system` 字段；
2. 把相邻的 user 角色节点合并成一条；
3. 把工具结果放成 user 消息里的 `tool_result` 块；
4. 按 `request/header` 的 config 写 `thinking`、`output_config`、`max_tokens`（实测循环请求里是 `{"type":"enabled"}`、`{"effort":"high"}`、`256000`），并由 dsh-base 的 `plugin-package-inventory-deepseek` 行附上 `dsh_plugin_packages`（`dsh@rc.1:packages/bundle/base/cordis.patch.yml:77-78`；`dsh@rc.1:packages/llm/plugin-package-inventory-deepseek/src/index.ts:1-29`）——这是一份已加载插件包的清单（`{"version":1,"packages":[{"name":"@boat/a2ui","version":"0.0.1"},{"name":"@boat/agent-demo",…},…]}`），**不进会话日志**，也不是模型可见的内容，所以不违反下面这条规则，但它意味着 boat 的插件组成会随每个官方请求发给服务端。

两个旁路请求的记录方式不一样：标题请求被 dsh 完整记录为 `session/title-llm-request`（seq 16，含 system、messages、route、`maxTokens`）；**路由请求只留一条审计 `boat/route-request`**（路由、候选名、决定、理由、耗时），完整的路由 prompt（`<available_skills>`、`<conversation_history>`、`<current_active_skill>`、`<latest_user_input>`）不在日志里。它可以由 `renderHistory(deriveMessages(), historyWindow)` 加 skill 快照重建（`skill-router/src/index.ts:311-317`），但比标题请求弱，对照“模型可见 ⟺ 已记录”这条规则时要记住。

另外，runtime-context 快照会在历史里累积：循环 #2 里既有 step 1 的快照（seq 11）也有 step 2 的（seq 23）。“supersedes earlier snapshots”是写给模型看的说明，内核不会删旧快照。

### 5.5 拒识回复的情况：`帮我炒股`

```jsonl
{"type":"step/start","seq":6,"time":1790184019874,"data":{"turn":1,"step":1}}
{"type":"system/message","seq":7,"time":1790184019874,"data":{"turn":1,"step":1,"message":{"role":"system","content":[],"source":{"kind":"system-prompt"},"id":"7d6c0805-…"}},"surfaceOp":"append"}
{"type":"user/message","seq":8,"time":1790184019875,"data":{"content":[{"type":"text","text":"帮我炒股"}],"source":{"kind":"user"},"role":"user","id":"2d70837f-…"},"surfaceOp":"append"}
{"type":"assistant/message","seq":9,"time":1790184019877,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"抱歉，我只负责资产配置相关的问题，不提供股票买卖建议。"}],"source":{"kind":"model","provider":"boat","model":"demo-hooks"},"id":"8d866a7c-…"},"stream":[]},"surfaceOp":"append"}
{"type":"step/end","seq":10,"time":1790184019877,"data":{"turn":1,"step":1}}
{"type":"session/title","seq":11,"time":1790184019878,"data":{"title":"帮我炒股","messageSeqs":[8],"source":{"kind":"fallback"}}}
{"type":"turn/end","seq":12,"time":1790184019879,"data":{"turn":1,"reason":{"kind":"completed"}}}
```

- **零个模型请求**：没有 `request/header`、`request/context`、`boat/route-request`、runtime-context，也没有标题 LLM 请求（标题插件要等到有 `request/header` 才启动）。整个 turn 7 ms。
- **为什么要写一个空的 `system/message`**：surface 的第 0 个节点保留给系统提示。reply 先放一个空头（`agent.ts:439-445`），之后真正的模型 step 会**替换**它而不是追加在历史末尾；第一次请求总是被当作新请求序列，所以空头一定被换掉（`agent.ts:473-481`）。
- **落盘只有两次**：帧 0+1 是 header 和 seq 0–2（投影缓存的 `session/created` 检查点）；帧 2 一次写下 seq 3–12，由投影缓存的 `turn/end` 检查点触发（`dsh@rc.1:packages/session/session-projection-cache/src/index.ts:316-317`），runner 的 `sessions.flush`（`boat/bundles/run/src/index.ts:233`）随后并入同一次排空。reply 分支在 `agent/pre-step` 之前就返回，没有 `llm/stream`、没有 `tools/execute`，检查点策略一次都没触发——**拒识路径在 turn 内部没有持久化点**。

### 5.6 为什么路由过的会话不能重开

dsh 的持久化层读日志时先过 `validateStoredEvents`（`dsh/session/session-persistence/src/storage-contract.ts:69-80`）：遇到编译进来的类型表（`dsh/core/session/src/known-event-types.ts`）之外的事件类型，除非事件带 `ignorable: true`，否则抛 `SessionFormatUnsupportedError`、拒绝整个日志——它可能是更新版本的 harness 写的，跳过一个必需事件会还原出错误的会话。`Session.append(type, data, surfaceOpts?)` 的参数里没有 `ignorable`（`dsh/core/session/src/index.ts:720-723`），所以插件目前没办法写出可忽略的事件。于是：

- `boat/route-request`、`boat/skill-routed` 是 boat 自己的节点，**路由过的会话不能被 `boat web` 或 resume 重开**。离线用 `validateStoredEvents` 检查上面几次运行（[7.5](#75-复现本文的运行) 的 `check-log.mjs` 最后一行）：拒识（b）和无 agent（d）两次通过（`reopen: ok`）；路由（a）和寒暄（c）两次被拒，报错 `contains event type "boat/route-request" (seq 6) unknown to this harness and not marked ignorable`。`boat/bundles/run/tests/reopen.composite.ts:109-113` 把这个限制钉成测试。
- 其它 boat 事实（卡片、状态、拒识回复、导入的历史）都用 dsh 认识的信封，能正常重开。这就是 `CLAUDE.md:77` 要求“新事件类型先证明能重开再上线，优先折进已有信封”的原因（`@boat/contracts` 文件头 `index.ts:9-16` 也写了）。

### 5.7 外部历史导入：种子怎么进日志

ark 用 `SessionHistoryMerger`（`base_agent.py:222`）把外部历史（SA 的 `sa_history`）并进会话；boat 把它做成 dsh 的**会话种子**：在 agent 发布之前写进日志的一串已经关闭的 turn。模型从第一次请求起就能看到这些历史，因为 `deriveMessages` 本来就从日志里的 surface 事件推导消息。

```mermaid
flowchart LR
  arg["--history sa.json<br/>boat-run-startup 解析<br/>startup.ts:58,90-91"] --> rf["historyImport.readFile<br/>parseSaHistory 清洗<br/>sa-history.ts:67-114"]
  rf --> sd["historyImport.seed<br/>seedFromRounds 生成 13 个事件<br/>seed.ts:39-77"]
  sd --> cr["agents.create<br/>seed · inheritedEventCount 13 · isSeeded<br/>run/src/index.ts:205-220"]
  cr --> es["Session 构造函数<br/>追加 session/end-seed inherited<br/>session/src/index.ts:613-619"]
  es --> st["appendUnstoredSuffix<br/>发布前把种子交给持久化 handle<br/>agent-loop/src/index.ts:692-709"]
  st --> pub["publish<br/>permission-presets 追加 seq 14-16"]
  pub --> task["followup 任务<br/>成为 turn 3"]
  task --> rep["第一个模型 step<br/>system/message 以 replace 换掉种子的空头"]
```

运行（[7.5](#75-复现本文的运行) 的 `repro.mjs`，不带 `--agent`）：

```console
$ node /tmp/repro.mjs run --history "$PWD/boat/bundles/run/tests/fixtures/history/sa.json" 继续刚才的话题
exit=0  requests=[loop, title]
stdout: 您好（PLAIN-OK）。
stderr: boat: imported 2 history round(s) from sa.json
```

fixture 里有 6 条 SA 记录：两轮完整的问答被保留；第三轮“那具体怎么调”只有用户消息（半轮），最后一条缺 `trace_id`，都被 `parseSaHistory` 丢掉（`boat/plugins/history-import/src/sa-history.ts:67-114`）。日志如下（header 是 `"isSeeded":true`，没有 `agentPreset`）：

| seq | 类型 | 关键字段 | 帧 |
|---|---|---|---|
| 0–6 | `turn/start` … `turn/end` | turn 1；seq 2 是空的 `system/message`（surface 第 0 个节点的占位）；seq 3 用户“帮我看看我的资产分布”，`source.kind: plugin:boat-history-import`；seq 4 助手回答，`source: {provider: boat, model: history-import}` | 1 |
| 7–12 | 同上 | turn 2：“稳健的比例是不是偏低” 和它的回答 | 1 |
| 13 | `session/end-seed` | `{inherited: true}`：继承前缀到这里为止 | 1 |
| 14–16 | `permission/preset`、`sandbox/mode`、`approval/policy` | 发布之后才追加 | 2 |
| 17–19 | `agent/inbox/spliced`、`turn/start`、`agent/inbox/spliced` | **`turn: 3`**：driver 从种子里的已关闭 turn 往后数 | 3 |
| 21 | `system/message` | `surfaceOp: {op: replace, startSeq: 2, endSeq: 2}`：真正的系统提示替换了种子的空头 | 4 |
| 22 | `user/message` | “继续刚才的话题” | 4 |
| 24 | `request/header` | `reason: initial`，24 个工具（没有 demo，所以没有 `asset_overview`） | 4 |
| 30 | `turn/end` | `turn: 3`，`completed` | 6 |

```jsonl
{"type":"system/message","seq":2,"time":1790189913420,"data":{"turn":1,"step":1,"message":{"role":"system","content":[],"source":{"kind":"system-prompt"},"id":"eac58f5c-…"}},"surfaceOp":"append"}
{"type":"user/message","seq":3,"time":1790189913420,"data":{"content":[{"type":"text","text":"帮我看看我的资产分布"}],"source":{"kind":"plugin:boat-history-import"},"role":"user","id":"2a9acd1c-…"},"surfaceOp":"append"}
{"type":"assistant/message","seq":4,"time":1790189913420,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"您的总资产 293,828.93 元：日常 62%、稳健 13%、进取 25%。"}],"source":{"kind":"model","provider":"boat","model":"history-import"},"id":"c901c5fe-…"},"stream":[]},"surfaceOp":"append"}
{"type":"session/end-seed","seq":13,"time":1790189913424,"data":{"inherited":true}}
{"type":"turn/start","seq":18,"time":1790189913475,"data":{"turn":3}}
{"type":"system/message","seq":21,"time":1790189913511,"data":{"turn":3,"step":1,"message":{"role":"system","content":[{"type":"text","text":"You are an AI agent powered by DeepSeek Harness.…(4148)"}],"source":{"kind":"system-prompt"},"id":"…"}},"surfaceOp":{"op":"replace","startSeq":2,"endSeq":2}}
```

`check-log.mjs` 对这份日志的输出：`loop #1: derived [system-prompt, plugin:boat-history-import, model, plugin:boat-history-import, model, user, runtime-context]`，系统文本、6 个文本块、24 个工具都和线上请求一致；线上的 `messages` 是 `user, assistant, user, assistant, user(2 个 text 块)`——导入的两轮就是前四条消息。最后一行 `reopen: ok`。

**为什么这样做**：

- **种子只用 dsh 认识的节点**，形状和拒识回复一样（空 system 头 + `surfaceOp: append` 的 user / assistant，`boat/plugins/history-import/src/seed.ts:1-10`），所以这种会话能被 dsh 重开；`boat/bundles/run/tests/reopen.composite.ts:102-106` 断言它含 `session/end-seed`、不含任何 `boat/*` 事件。
- **trace id 不进日志**，而是作为 `SeedResult.imported` 返回（`seed.ts:6-8`）：写成 boat 专有节点会让日志无法重开（见 5.6）。
- **种子在发布之前落盘**：种子事件不经过 `session/event`，所以 `AgentLoop` 在 publish 前用 `appendUnstoredSuffix` 直接交给持久化 handle（`dsh/core/agent-loop/src/index.ts:692-709`）；帧 1 里只有 seq 0–13，发布后的 seq 14–16 在帧 2。
- **任务是 turn 3**：`boat-run` 的注释写明了意图——种子是 driver 计数用的已关闭 turn，所以第一次请求就推导出导入的轮次（`boat/bundles/run/src/index.ts:205-206`）。

---

## 6. 端到端例子回顾

把 `node boat/apps/cli/lib/bin.js run --agents ./boat/agents --agent demo "看看资产"` 从头到尾串一次（进程总耗时约 1.7 s，其中 turn 本身 308 ms，其余主要是启动）：

| 时刻 | 发生了什么 | 关键代码 | 本文 |
|---|---|---|---|
| 进程启动 | `BOAT_HOME` 写进 `DSH_HOME`，启动器只拿走自己的参数 | `bin.ts:8-12`，`home.ts:47-50`，`args.ts:109-118` | 3.2 A |
| 组合 | profile `run` = dsh-base + `@boat/host` + `@boat/run`，bundle 准入、行准入，100 行 | `profile-boot.ts:161-172`，`compatibility-preflight.ts:180-187` | 2.4、3.2 B–C |
| 激活 | 内核服务、5 个 boat 宿主服务、`boatRunStartup`、`agentPresets` 按依赖陆续可用；根 realm 65 个服务 | `cordis.patch.yml` 三层 | 2.1、3.2 D |
| agent 就绪 | demo 目录挂到 standing scope（4 行 ACTIVE），`agents.create` 造出 agent scope 并绑到 standing scope，日志 seq 0–2 | `run/src/index.ts:165-220`，`agent-loop/src/index.ts:717-783` | 2.2、3.2 E |
| turn 开始 | `followup` → inbox → `turn/start` → 领取 | `agent.ts:167-169,323`，`inbox.ts:109-112` | 4.1 |
| 拒识门 | demo-hooks 没命中，`pass` | `hooks.ts:20-26` | 4.1 |
| 路由 | skill-router 旁路调用 59 ms，选中 `asset-overview`，`boat/route-request` + `boat/skill-routed`，放开 `asset_overview` | `skill-router/src/index.ts:292-404` | 4.2 |
| 组装 | 系统提示约 4.2k 字符（随 cwd 长度变化），runtime context 含 `boat:skill`，25 个工具 | `system-prompt/src/index.ts:558`，`runtime-context.ts:150-163`，`agent.ts:293-299` | 4.1 |
| 第 1 次循环 | 模型调 `asset_overview`；工具出卡、出 delta；`tool/result.meta.boat` | `tools.ts:40-74`，`tools/src/index.ts:1843`，`tool-calls.ts:282-289` | 4.2、5.3 |
| 投影 | `boatCards` 收下卡片，`boatState` 合并 delta | `a2ui/src/index.ts:101-113`，`state.ts:78-98` | 5.3 |
| 第 2 次循环 | runtime context 多了 `boat:state`，模型据此回答“您的资产总览已生成（DEMO-OK）。” | `tool-policy/src/index.ts:108-116` | 4.1、5.2 |
| 收尾 | `turn/end completed`；投影缓存的 `turn/end` 检查点写下帧 10，runner 的 flush 随后并入；stdout 打印答案，`appExit(0)` 释放根 fiber | `run/src/index.ts:229-239`，`profile-boot.ts:204-207` | 5.2 |

这个例子覆盖了 boat 目前除外部历史导入（[5.7](#57-外部历史导入种子怎么进日志)）以外的全部机制：发行版内核（同名接管的 `dsh-agent-loop` 派发了两个扩展事件）、patch 组合（`@boat/host` 和 `@boat/run` 的行）、DI（agent 行同时注入内核与 boat 服务）、scope（demo 的工具和监听只作用于 demo）、日志即事实（卡片与状态骑在 `tool/result.meta` 上，模型请求由日志推导）。

---

## 7. 附录

### 7.1 服务一览表

`run` 组合下根 realm 的 65 个服务里与本文有关的部分（“boat”指 `@boat/*` 发布的服务）。最后一列的“静态注入者”是实测结果：用一个 `--plugin` 探针遍历 Loader 的所有行，读每行合并后的 `inject`（静态 + 行级），列的是根树里的**行 id**；demo 的 agent 行（`persona`、`boat-skill-router`、`demo-tools`、`demo-hooks`）单独注明。`ctx.get` 的可选读取不在 `inject` 里，另外写出。

| 服务键 | 发布者（行 → 包） | 来源 | 静态注入者（根树行 id，实测）；另有的读取方 |
|---|---|---|---|
| `loader` | `boot()` → cordis-plugin-loader | npm | include、plugin-manager、typert-loader、plugin-package-inventory-deepseek、config-editor、agent-preset-registry；`boat-run` 用 `ctx.get` |
| `dshHomePath` | `boot()`（`app-boot/src/index.ts:993`） | npm | `!!js` 表达式（jsonl 根目录、storage-json 根目录） |
| `profileContext`、`launchEnvironment` | boat 的 `prepare`（`profile-boot.ts:236-237`） | boat 启动器 | config-editor、plugin-manager、dsh-base 里的 `disabled` 表达式、行准入 |
| `pluginPackages` | `PluginPackages`（`profile-boot.ts:239`） | npm app-boot | 行准入读 manifest |
| `cmdlineArgs`、`appExit`、`appReady` | `provideCmdline`（`profile-boot.ts:240-244`） | npm dsh-cmdline | `boat-run-startup`（`cmdlineArgs`）；`boat-run`（`ctx.get('appExit')`） |
| `llm` | `llm` → dsh-llm | **内核** | session-title-llm、llm-pi-ai、compaction-basic、session-checkpoint-policy、agent-loop、llm-deepseek、boat-skill-router |
| `tools` | `tools` → dsh-tools | 内核 | tool-bash、tool-jobs、tool-fs、tool-fs-search、tool-skill、plan-mode、tool-subagent-control、tool-subagent-list-agents、tool-subagent、tool-subagent-fork、tool-workflow、timeout-policy、spill-policy、session-checkpoint-policy、tool-todo、tool-goal、tool-web、mcp-resources、agent-loop、boat-tool-policy、boat-skill-router、boat-a2ui；agent 行 demo-tools |
| `skills` | `skill` → dsh-skill | **内核** | skill-filesystem、tool-skill、boat-skill-router；agent 行 demo-tools |
| `sessions` | `session` → dsh-session | 内核 | session-log-deepseek、session-title、session-title-llm、session-query-sqlite、session-projection-cache、permission、goal-round-driver、compaction-basic、session-checkpoint-policy、image-offload、agent-loop、boat-run |
| `systemPrompt` | `system-prompt` → dsh-system-prompt | 内核 | tool-bash、tool-jobs、tool-fs、tool-fs-search、plan-mode、tool-subagent、tool-subagent-fork、tool-workflow、tool-goal、tool-web、tools、agent-loop、boat-tool-policy、boat-skill-router；agent 行 persona |
| `sessionProjections` | `session-projection` → dsh-session-projection | 内核 | session-title、llm-retry、session-projection-cache、sandbox-policy、permission、agent-instructions、goal、plan-mode、token-meter、tool-subagent、tool-subagent-fork、tool-todo、tool-goal、agent-loop、boat-tool-policy、boat-skill-router、boat-a2ui、agent-preset-registry；agent 行 demo-tools |
| `sessionPersistence` | `session-persistence-jsonl` → dsh-session-persistence-jsonl | 内核 | session-checkpoint-policy；AgentLoop 用 `ctx.get` / 嵌套 inject |
| `compaction` | `compaction-basic` → dsh-compaction-basic | 内核 | command-compact |
| `agents` | `agent` → dsh-agent | 内核 | plugin-package-inventory-deepseek、llm-retry、tool-skill、goal、goal-round-driver、tool-subagent-list-agents、image-offload、tool-goal、agent-loop、boat-run |
| `agentLoop` | `agent-loop` → dsh-agent-loop | 内核，带 boat 的两个扩展 | 无静态注入者；它把自己注册成 `agents` 的工厂 |
| `approval` | `approval` → dsh-user-approval | npm | permission（dsh-permission-presets）；tools 运行时 `ctx.get`——tool-policy 的 `ask` 走到这里 |
| `agentDefaultModel` | `agent-default-model` | npm | `boat-run` |
| `agentPresets` | `agent-preset-registry`（`@boat/run` 插入） | npm | `boat-run`（`ctx.get`） |
| `boatDistro` | `boat-distro` → `@boat/distro` | boat | 仓库内无注入者；给第三方插件用 |
| `toolPolicy` | `boat-tool-policy` → `@boat/tool-policy` | boat | boat-skill-router、boat-a2ui；agent 行 demo-tools（其它 agent 可用 `@boat/tool-policy/agent` 行） |
| `skillRouter` | `boat-skill-router` → `@boat/skill-router` | boat | `@boat/skill-router/agent` 行 |
| `a2ui` | `boat-a2ui` → `@boat/a2ui` | boat | `@boat/a2ui/agent` 行、demo-tools |
| `historyImport` | `boat-history-import` → `@boat/history-import` | boat | `boat-run` |
| `boatRunStartup` | `boat-run-startup` → `@boat/run/startup` | boat | `agent-preset-registry` 行、`boat-run` 行（行级 inject） |

其余如 `permissionPresets`、`sandbox`、`sandboxPolicy`、`shell`、`fs`、`typert`、`tokenMeter`、`goals`、`jobs`、`settings`、`sessionTitle`、`storage*` 等由 dsh-base 对应的行发布，供它们各自的工具和 provider 行使用。

### 7.2 事件一览表

| 事件 | 派发方式 | 产生者（代码） | 消费者 | 伴随追加的日志事件 |
|---|---|---|---|---|
| `agent/inbox/inserted` | emit | inbox（`inbox.ts:240`） | — | `agent/inbox/spliced`（插入） |
| `agent/status` | emit | driver（`agent.ts:154`） | compaction-basic、goal-round-driver、web 的 session-controller、schedule 等；`whenIdle` 不监听它，而是等 `activityDone`（`agent.ts:241-246`） | — |
| `agent/inbox/claimed` | emit | inbox（`inbox.ts:112`） | — | `agent/inbox/spliced`（领取，带 `removedCount`，`inbox.ts:109-112`，经 `mutate` 在 234 行追加）；首个 step 之前已有 `turn/start`（`agent.ts:323`） |
| **`boat/intake`** | waterfall，默认 `pass` | driver（`agent.ts:279-282`） | demo-hooks（agent 行） | reply 时：`step/start`、空 `system/message`、`user/message`、`assistant/message`（provider `boat`）、`step/end` |
| **`boat/pre-assemble`** | waterfall | driver（`agent.ts:285-288`） | tool-policy（`next` 之后）、skill-router（`next` 之前）、agent 行与 `--plugin` 行 | dynamic 模式：`boat/route-request`、`boat/skill-routed` |
| `llm/stream`（路由旁路） | waterfall | skill-router（`skill-router/src/index.ts:365`） | checkpoint-policy（flush） | 无 surface 事件，审计在 `boat/route-request` |
| `tools/change` | emit | tools：注册、注销工具或 restrict 改变时（`tools/src/index.ts:200`、`832-835`） | — | — |
| `system-prompt/assemble` | waterfall | systemPrompt（`system-prompt/src/index.ts:626`） | 无 boat 监听 | — |
| `agent/pre-step` | waterfall，默认 enter + context | driver（`agent.ts:294-300`） | compaction-basic、checkpoint-policy、agent-instructions、tool-skill、plan-mode、repeat-tool-reminder、goal-round-driver、模型选择 | 可能触发 `session/flush`；压缩时追加 `compaction/*` |
| `session/flush` | parallel 语义（经 `sessions.flush`） | `session/src/index.ts:1176-1193` | JSONL 后端、投影缓存 | 缓冲的事件落盘 |
| `agent/request` | waterfall | driver（`agent.ts:643`） | 模型选择 | 随后 `system/message`、`user/message`×N、`request/header`、`request/context` |
| `llm/stream`（循环） | waterfall | driver（`agent.ts:503`）→ llm（`llm/src/index.ts:1122`） | checkpoint-policy、适配器 | — |
| `agent/assistant-stream` | emit，不持久化 | driver（`agent.ts:499`） | `boat run` 推理打印、web 历史流 | — |
| `agent/request-error` | waterfall | driver（`agent.ts:561`） | llm-retry | `assistant/attempt` |
| `tools/pre-execute` | waterfall，默认 `allow` | tools（`tools/src/index.ts:1505`） | tool-policy（需确认时 `ask`） | 之前已追加 `tool/call` |
| `approval/request` | waterfall，默认 `unavailable` | user-approval | — | `approval/asked`、`approval/decided` |
| `tools/execute` | waterfall | tools（`tools/src/index.ts:1605`） | checkpoint-policy、timeout | —（`meta.boat.*` 在这里由 `presentationMeta` 算出） |
| `tools/post-execute` | waterfall，默认 `accept` | tools（`tools/src/index.ts:1781`） | spill-policy、repeat-tool-reminder；**boat 无** | — |
| `tools/result` | emit | tools（`tools/src/index.ts:1703`） | skill-router（模型调 `skill` 工具时） | 随后 `tool/result`；之后异步 `boat/skill-routed{source: model}` |
| `session/event` | emit，每次 append | `session/src/index.ts:757-762` | 投影注册表、JSONL 后端 | 每一条 |
| `agent/turn-stopping` | serial | driver（`agent.ts:356,385`） | — | 随后 `turn/end` |
| `agent/error` | emit | driver（`agent.ts:252`） | — | `turn/end{kind: error}` |

### 7.3 术语表

| 术语 | 含义 |
|---|---|
| dsh | DeepSeek Harness，上游 agent 框架（`deepseek-ai/deepseek-harness`） |
| 内核（kernel） | boat 拥有源码的 13 个 dsh 包，清单在 `dsh/kernel.json` |
| 发行版 | 拥有上游核心源码、保留上游名字、承诺兼容上游生态的衍生版本 |
| Cordis | dsh 用的 IoC 框架（`@deepseek-ai/cordis` 4.0.4） |
| 行（row / entry） | 插件树里的一项：`{id, name, config, inject?, disabled?}` |
| bundle | 一个带 `dsh.bundle.patch` 的包，提供一层 patch（dsh-base、`@boat/host`、`@boat/run`） |
| profile | `$BOAT_HOME/profiles/<name>`，列出 bundle 并持有用户层 patch |
| patch 层 | 对行列表的增删改；按 id 定位，后写的赢，替换整行 `config` |
| 准入（admission） | 启动时按 manifest 的 dsh peer 检查 bundle 和行，不兼容的跳过或禁用 |
| 服务（service） | 发布在 Context 上的对象，按键名注入 |
| fiber | 插件实例的生命周期对象（PENDING / LOADING / ACTIVE / FAILED / UNLOADING / DISPOSED） |
| effect / disposer | 登记的副作用及其撤销函数，fiber 卸载时逆序执行 |
| realm | 服务键的命名空间；同一 realm 里 `ctx.x` 指向同一个服务 |
| 根 realm | 没有 `isolate` 的服务所在的全局命名空间 |
| isolate | 行上的选项，`{x: true}` 给这一行及其子行一个私有的 `x`，`{x: '<标签>'}` 进入按标签共享的 realm |
| group 行 | `name: cordis:group` 的行，把一组子行包在一起，常和 `isolate` 连用，让提供者和消费者共享私有 realm |
| generation | preset 注册表对一次 preset 激活的记录；`retired` 且 `users` 为 0 时释放它的 standing scope |
| standing scope | preset 注册表给一个 preset 修订创建的 scope，agent 行挂在这里 |
| agent scope | 每个 agent 实例一个，父级绑定到 standing scope |
| agent / agent 实例 | agent 是 `boat/agents/<id>` 这个定义；实例是 dsh 每个会话创建的运行时 `Agent` |
| preset | dsh-agent-preset-registry 对 agent 定义的叫法 |
| emit | 同步依次调用所有监听，不等 Promise，返回值被忽略，谁也不能否决（`dsh@rc.1:vendor/cordis/src/events.ts:194`） |
| parallel | 所有监听并发执行并等全部结束；有监听失败就抛 `AggregateError`（`events.ts:183`） |
| serial | 依次 await 每个监听，第一个返回非空值的截断后续并返回该值（`events.ts:204`） |
| waterfall | 监听按注册顺序层层包裹（先注册的在外层，`prepend: true` 的放到最外层），必须调 `next()`，否则里层和默认行为都不执行（`events.ts:234,254-260`） |
| surface | 日志中带 `surfaceOp` 的事件，`deriveMessages` 从它们推导模型消息 |
| runtime context | 以 user 消息形式注入的运行时快照（`sandbox:policy`、`boat:state`、`boat:skill`…） |
| 投影（projection） | 对日志事件的纯折叠，`apply(state, event)` 没变化时返回同一引用 |
| 信封（envelope） | dsh 已认识的日志字段，如 `tool/result.meta`、assistant 消息的 `source` |
| 扩展（extension） | boat 对内核契约的新增，登记在 `compatibility/contract/extensions.yml`，带退出条件 |
| `boatDistro` | 标记“这是 boat”的服务，第三方插件注入它来使用扩展 |

### 7.4 已知的坑

| 现象 | 原因 | 依据 |
|---|---|---|
| 某个宿主服务缺失时 `boat run` 挂住不退出 | `boat-run` 不在启动审计的必需列表里，只打 warning | 2.3 例子 3；`app-boot/src/index.ts:744-752` |
| 组合测试和启动器的行为不同 | `bootComposition` 不提供 `profileContext`，所以没有行准入，plugin-manager、config-editor、settings、hmr 被禁，裸名按工作区根解析 | `boat/tooling/testing/src/composition.ts:170-174`；`compatibility-preflight.ts:183` |
| `config dump` 看不到遥测开关那一层 | `dump-config.ts` 自己拼层，没有调 `resolveTelemetryPatch` | `boat/apps/cli/src/dump-config.ts:36-56` |
| `boat web` 跑不了 `boat/agents/*` | 只有 `@boat/run` 声明 agent 目录 | 3.3 |
| 仓库内的 boat 插件监听 `boat/*` 却没注入 `boatDistro` | 只要求第三方插件注入 | `compatibility/COMPAT.md:46` |
| `boat web` 热重载的诊断前缀是 `dsh` | dsh-hmr 写死了 `'dsh'` | `dsh@rc.1:packages/boot/hmr/src/index.ts:229-230` |
| 路由过的会话不能重开 | `boat/*` 节点不在 dsh 的事件目录里 | 5.6 |
| 拒识路径 turn 内没有持久化点 | reply 在 `agent/pre-step` 之前返回，检查点不触发 | 5.5 |
| 禁掉 `session-persistence-jsonl` 后 `boat run` 成功却没有日志 | `AgentLoop` 只可选地 `ctx.get('sessionPersistence')`，没有后端就只在内存里 | 3.4 |
| `skill` 行缺失时带 `--agent demo` 退出 1 | demo 的 `demo-tools` 注入 `skills`，preset 挂载审计判 broken | 3.4 |
| 发给官方端点的请求带插件包清单 | dsh-base 的 `plugin-package-inventory-deepseek` 行附上 `dsh_plugin_packages`；`@boat/host` 只关了会话日志附件 | 5.4；`dsh@rc.1:packages/bundle/base/cordis.patch.yml:77-78` |
| 标题可能在 `turn/end` 之后才写入 | 标题请求异步；寒暄（c）和无 agent（d）两次运行里 provider 标题排在 `turn/end` 之后，关闭时才落盘 | 所以测试的规范化直接丢掉 `session/title*`（`boat/tooling/testing/src/session-log.ts:151,155-166`） |

### 7.5 复现本文的运行

**前提**：在 boat 仓库根目录，依赖已装好并构建过（`pnpm run build`，产出 `boat/apps/cli/lib/bin.js` 和 `boat/tooling/testing/lib/*.js`）。全程不需要真实 key，也不会碰你的 `~/.boat`。

**方式一：进程内的组合测试**。它启动同样的三个 bundle、用脚本化模型、对日志断言，最省事：

```console
pnpm run build
npx vitest run --project composite boat/agents/demo/tests/demo.composite.ts
```

**方式二：在构建好的 CLI 上跑，拿到真实日志**。脚本化模型只是一个库（`startScriptedModel`，`boat/tooling/testing/src/scripted-model.ts:125`），没有命令行入口，所以要一个小脚本把它起起来、再用子进程跑 CLI。把下面的内容存成仓库外的任意文件，例如 `/tmp/repro.mjs`：

```js
// 在 boat 仓库根目录运行（先 pnpm run build）：
//   node <本文件> run --agents "$PWD/boat/agents" --agent demo 看看资产
// 脚本化模型 + 构建好的 CLI；BOAT_HOME 和工作区都在一个新的临时目录里。
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = process.cwd()
const lib = (file) => import(pathToFileURL(join(repo, 'boat/tooling/testing/lib', file)).href)
const { startScriptedModel, withTitle } = await lib('scripted-model.js')
const { findSessionLogs, readSessionLog } = await lib('session-log.js')

// 路由按 <latest_user_input> 选 skill（同 boat/agents/demo/tests/demo.composite.ts:36-46）；
// 循环请求里有 asset_overview 且还没调过就调一次，然后回答。
const latest = (r) => /<latest_user_input>([\s\S]*?)<\/latest_user_input>/u.exec(r.lastUser)?.[1] ?? ''
function script(r) {
  if (r.purpose === 'router') {
    const pick = /资产/u.test(latest(r)) ? { skill_id: 'asset-overview', reason: '观察类' } : { skill_id: null, reason: '寒暄' }
    return { text: JSON.stringify(pick) }
  }
  if (r.toolNames.includes('asset_overview') && !r.calledTools.includes('asset_overview')) {
    return { toolCall: { name: 'asset_overview', arguments: {}, id: 'call-overview' } }
  }
  return { text: r.calledTools.length > 0 ? '您的资产总览已生成（DEMO-OK）。' : '您好（PLAIN-OK）。' }
}

const model = await startScriptedModel(withTitle(script), { apiKey: 'mock-key' })
const out = mkdtempSync(join(tmpdir(), 'boat-repro-'))
const home = join(out, 'boat-home')
const workspace = join(out, 'workspace')
mkdirSync(workspace, { recursive: true })
const env = {
  ...process.env,
  BOAT_HOME: home,
  DSH_TELEMETRY_DISABLED: '1',
  DEEPSEEK_BASE_URL: `${model.baseURL}/v1`,
  DEEPSEEK_API_KEY: 'mock-key',
}
// 脚本化模型只听回环地址：子进程不能走代理。
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) delete env[k]
// 异步 spawn：模型服务器跑在本进程的事件循环里，spawnSync 会让它答不了请求。
const child = spawn(process.execPath, [join(repo, 'boat/apps/cli/lib/bin.js'), ...process.argv.slice(2)], { cwd: workspace, env })
let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => { stdout += d })
child.stderr.on('data', (d) => { stderr += d })
const code = await new Promise((resolve) => child.on('close', (c, s) => resolve(c ?? s)))
await model.close()

console.log(`exit=${code}  requests=[${model.requests.map((r) => r.purpose).join(', ')}]`)
console.log(`stdout: ${stdout.trim()}`)
if (stderr.trim() !== '') console.log(`stderr: ${stderr.trim()}`)
writeFileSync(join(out, 'requests.json'), JSON.stringify(model.requests, null, 1))
for (const log of findSessionLogs(home)) {
  console.log(`log: ${log}`)
  for (const rec of readSessionLog(log)) console.log(rec.type === 'session' ? `header ${JSON.stringify(rec)}` : `seq ${rec.seq} ${rec.type}`)
}
console.log(`out: ${out}`)
```

在仓库根目录运行（`--agents` 要给绝对路径，因为子进程的 cwd 是临时 workspace）：

```console
$ node /tmp/repro.mjs run --agents "$PWD/boat/agents" --agent demo 看看资产
exit=0  requests=[router, loop, title, loop]
stdout: 您的资产总览已生成（DEMO-OK）。
log: /tmp/boat-repro-XXXXXX/boat-home/sessions/<编码后的 workspace 路径>/session-<uuid>/session.v4.jsonl.zstd
header {"type":"session","version":4,"id":"session-<uuid>","createdAt":…,"cwd":"/tmp/boat-repro-XXXXXX/workspace","isSeeded":false,"delegationDepth":0,"agentPreset":"demo"}
seq 0 permission/preset
…
seq 26 turn/end
out: /tmp/boat-repro-XXXXXX
```

脚本的要点和原因：

- 路由请求按 `<latest_user_input>` 里的文字回答，规则同 `boat/agents/demo/tests/demo.composite.ts:36-46`；标题请求由 `withTitle` 固定回答（`scripted-model.ts:161-164`）。脚本化模型按系统提示分辨请求用途（`scripted-model.ts:69-82`）。
- 必须用异步 `spawn`：模型服务器跑在父进程的事件循环里，`spawnSync` 会让它答不了请求。
- 子进程去掉 `HTTP_PROXY` 一类变量：脚本化模型只监听 `127.0.0.1`。
- `DEEPSEEK_BASE_URL` 带 `/v1`：适配器看到结尾已是 `/v1` 就不再补（`dsh@rc.1:packages/llm/llm-deepseek/src/messages-api.ts:11-14`），请求落在脚本化模型服务的 `/v1/messages`。
- `requests.json` 存下模型收到的每个请求体，供下一个脚本对照。

**离线分析日志**（[5.4](#54-日志怎么映射回模型看到的内容) 的请求重建、[5.6](#56-为什么路由过的会话不能重开) 的重开检查）。存成 `/tmp/check-log.mjs`，参数是上一步打印的 `out:` 目录：

```js
// 在 boat 仓库根目录运行：node <本文件> <repro.mjs 打印的 out 目录>
// 1) 用内核的 Session.create(...).deriveMessages() 重建每个循环请求，和脚本化模型收到的请求比较；
// 2) 用 dsh 持久化层的 validateStoredEvents 检查这份日志能否被重开。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = process.cwd()
const load = (p) => import(pathToFileURL(join(repo, p)).href)
const { Session, SessionId, SESSION_FORMAT_VERSION } = await load('dsh/core/session/lib/index.js')
const { validateStoredEvents } = await load('dsh/session/session-persistence/lib/index.js')
const { findSessionLogs, readSessionLog } = await load('boat/tooling/testing/lib/session-log.js')

const out = process.argv[2]
const [header, ...events] = readSessionLog(findSessionLogs(join(out, 'boat-home'))[0])
const loops = JSON.parse(readFileSync(join(out, 'requests.json'), 'utf8')).filter((r) => r.purpose === 'loop')

const wireText = (b) => b.type === 'text' ? b.text : b.type === 'tool_use' ? `call:${b.name}` : b.type === 'tool_result' ? `result:${(b.content ?? []).map((c) => c.text).join('')}` : b.type
const logText = (b) => b.type === 'text' ? b.text : b.type === 'tool-call' ? `call:${b.name}` : b.type
// 每个模型回复（assistant/message，排除 provider=boat 的拒识回复）之前的日志前缀，就是那次请求派发时的会话。
const cuts = events.filter((e) => e.type === 'assistant/message' && e.data.message.source.provider !== 'boat').map((e) => e.seq)
cuts.forEach((cut, i) => {
  const prefix = events.filter((e) => e.seq < cut)
  const derived = Session.create(header.id, prefix).deriveMessages()
  const wire = loops[i].body
  const system = derived.filter((m) => m.role === 'system').map((m) => m.content.map(logText).join('')).join('\n')
  const flat = derived.filter((m) => m.role !== 'system').flatMap((m) => m.role === 'tool' ? [`result:${m.content.map(logText).join('')}`] : m.content.map(logText))
  const tools = (prefix.findLast((e) => e.type === 'request/header')?.data.header.tools ?? []).map((t) => t.name).sort()
  console.log(`loop #${i + 1}: derived [${derived.map((m) => m.source?.kind ?? m.role).join(', ')}]`)
  console.log(`  system equal=${system === wire.system}  blocks equal=${JSON.stringify(flat) === JSON.stringify(wire.messages.flatMap((m) => m.content.map(wireText)))} (${flat.length})  tools equal=${JSON.stringify(tools) === JSON.stringify(loops[i].toolNames.toSorted())} (${tools.length})`)
})

try {
  validateStoredEvents({ id: SessionId(header.id), version: SESSION_FORMAT_VERSION, createdAt: header.createdAt, isSeeded: header.isSeeded }, structuredClone(events))
  console.log('reopen: ok')
} catch (error) {
  console.log(`reopen: refused: ${error.message}`)
}
```

```console
$ node /tmp/check-log.mjs /tmp/boat-repro-XXXXXX
loop #1: derived [system-prompt, user, runtime-context, skill-catalog]
  system equal=true  blocks equal=true (3)  tools equal=true (25)
loop #2: derived [system-prompt, user, runtime-context, skill-catalog, model, tool, runtime-context]
  system equal=true  blocks equal=true (6)  tools equal=true (25)
reopen: refused: session "session-<uuid>" contains event type "boat/route-request" (seq 6) unknown to this harness and not marked ignorable; refusing to interpret the log — it was likely written by a newer harness
```

本文用到的运行（a–d 是正文的样本日志，e 是 5.7 的历史导入；`<abs>` 是仓库根目录的绝对路径）：

| 标签 | `repro.mjs` 的参数 | 退出码 | 模型请求 | stdout | `check-log.mjs` 的重开结果 |
|---|---|---|---|---|---|
| a | `run --agents <abs>/boat/agents --agent demo 看看资产` | 0 | 路由、循环、标题、循环 | `您的资产总览已生成（DEMO-OK）。` | refused（`boat/route-request`） |
| b | `run --agents <abs>/boat/agents --agent demo 帮我炒股` | 0 | 无 | `抱歉，我只负责资产配置相关的问题，不提供股票买卖建议。` | ok |
| c | `run --agents <abs>/boat/agents --agent demo 你好` | 0 | 路由、循环、标题 | `您好（PLAIN-OK）。` | refused（`boat/route-request`） |
| d | `run 你好` | 0 | 循环、标题 | `您好（PLAIN-OK）。` | ok |
| e | `run --history <abs>/boat/bundles/run/tests/fixtures/history/sa.json 继续刚才的话题` | 0 | 循环、标题 | `您好（PLAIN-OK）。` | ok |

[3.4](#34-启动保证哪些能力) 的禁行实验也用 `repro.mjs`：把 patch 文件写在仓库外（例如 `printf -- '- id: llm\n  disabled: true\n' > /tmp/no-llm.yml`），再 `node /tmp/repro.mjs run --patch /tmp/no-llm.yml 你好`。
