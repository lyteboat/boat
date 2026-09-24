# 轻舟 lyteboat

[![CI](https://github.com/lyteboat/boat/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/lyteboat/boat/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**中文** | [English](README.en.md)

> **轻舟智能体底座 —— 赋能行业穿越 AI 万重山。**

轻舟（lyteboat）是构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）之上的业务智能体底座。它不是 coding agent，而是生产级就绪、开箱即用的业务 harness：让 AI 能干活、干得对、有迹可查。

- [为什么是轻舟](#为什么是轻舟)
- [特性](#特性)
- [快速开始](#快速开始)
- [使用](#使用)
- [文档](#文档)
- [项目结构](#项目结构)
- [开发](#开发)
- [状态与路线图](#状态与路线图)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 为什么是轻舟

大模型是发动机，不是收割机。发动机再强，不装上专用设备就不收粮食。

今天各行业面临的局面完全一样：模型能力已不是瓶颈，把模型接进真实业务、跑通最后一公里才是。最后一公里里没有新算法，只有一件件具体的事：模型在哪一步该看到哪些工具，哪些操作必须先经人确认，业务状态以谁为准，结果怎样以业务界面交到用户手里，出了问题怎样还原模型当时看到了什么。每个行业团队都要把这些重新做一遍。

轻舟把这最后一公里做成一套可复用的垂域智能体底座。行业团队加上业务技能、业务工具和卡片模板，就能得到一个上得了生产的智能体。

## 特性

- **业务能力开箱即用。** 都以 Cordis 插件的形式挂在 dsh 的接缝上，框架包不含任何业务词汇：
  - 技能路由：`full` 把全部技能正文放进提示；`dynamic` 每轮用一次旁路模型调用选出技能，并在同一步生效；路由结果是 dsh 自己的技能调用消息，会话能重开、能续聊（`@lyteboat/skill-router`）。
  - 工具可见性、调用前确认、工具结果里的状态增量（`@lyteboat/tool-policy`）。
  - A2UI 模板卡片：一个工具结果可以带多张卡，按发射模式立即出，或由回答里的 `[[card:区域]]` 标记放到位（`@lyteboat/a2ui`）。
  - 请求上下文：一条请求带着自己的上下文和准入判定进日志，会话内沿用（`@lyteboat/request-context`）。
  - 准入前移：agent 登记准入函数，请求进循环前就放行或直接回复，回复可以带卡（`@lyteboat/intake-guard`）；底层的拒识钩子 `lyteboat/intake` 仍可直接用。
  - 旁路模型调用留痕：路由、分类这类旁路调用在会话里留下完整的 prompt 和回答（`@lyteboat/aux-llm`）。
  - 外部对话历史导入（`@lyteboat/history-import`）。
- **一个业务 agent 就是一个目录。** 在 `lyteboat/agents/<id>/` 下写组合文件、技能、工具和卡片模板即可。
- **与 dsh 生态兼容。** 轻舟是 dsh 的一个发行版：它以原包名接管 dsh 内核 13 个包的源码（`dsh/`），官方包和社区插件不改一行就跑在轻舟的实现上。与所跟踪的 dsh 版本在协议、接口、行为上保持兼容，由 G1–G6 六道闸门证明（[`dsh-compat/`](dsh-compat/README.md)）。
- **有迹可查。** 模型看到的一切都能从会话日志还原；轻舟记录的事实都放在 dsh 已有的日志信封里。

## 快速开始

### 环境要求

- Node.js 22.19+ 或 24+
- pnpm 11.7（`corepack enable` 会按 `package.json` 取到钉住的版本）

### 安装与构建

```sh
git clone https://github.com/lyteboat/boat.git
cd lyteboat
corepack enable
pnpm install
pnpm run build
```

启动器是 `lyteboat/apps/cli/lib/bin.js`，下文用 `lyteboat` 指代它，可以先设一个别名：

```sh
alias lyteboat="node $PWD/lyteboat/apps/cli/lib/bin.js"
```

### 配置模型

轻舟沿用 dsh 的模型配置：在环境变量或 `$LYTEBOAT_HOME/.env` 里设置 `DEEPSEEK_API_KEY`。`DEEPSEEK_BASE_URL` 可选，指向一个兼容 DeepSeek Anthropic Messages API 的端点。

旁路调用（技能路由、准入分类）用路由自己的默认推理强度；DeepSeek 默认先思考再作答，思考同样计入这次调用的 `maxTokens`。要让旁路调用直接作答，用一个 patch 文件给 `lyteboat-aux-llm` 行配上推理强度，运行时 `--patch` 叠上：

```yaml
- id: lyteboat-aux-llm
  config:
    reasoningEffort: 'off'    # 取值由路由的模型适配器定义，这是 DeepSeek 的
```

### 运行

```sh
lyteboat run "总结一下这个工作区"                              # 一次性任务：答完即退出
lyteboat run --agents ./lyteboat/agents --agent finance --context '{"customer":"young-idle-cash"}' "看看我的资产"   # 金融智能体：请求上下文指明客户
lyteboat web --no-open                                         # 浏览器界面
```

## 使用

### 命令

| 命令 | 作用 |
|---|---|
| `lyteboat run [选项] "任务"` | 回答一个任务，打印结果后退出（profile `run`） |
| `lyteboat web [选项]` | 启动浏览器界面（profile `web`）；`lyteboat web --help` 查看它自己的参数 |
| `lyteboat config dump [选项]` | 打印组合后的插件树并退出；`--default` 只看 bundle 层 |

三个命令都接受：

| 选项 | 作用 |
|---|---|
| `--profile <名字>` | 启动 `$LYTEBOAT_HOME/profiles` 下的哪个 profile |
| `--patch <路径>` | 在 profile 层之后再叠一层 patch（可重复） |
| `--plugin <文件>` | 把一个本地 ESM 插件文件插进插件树（可重复） |

`lyteboat run` 另有：

| 选项 | 作用 |
|---|---|
| `--agents <目录>` | 存放 agent 的目录（可重复） |
| `--agent <id>` | 运行其中的某个 agent（`--preset` 是已废弃的别名） |
| `--history <文件>` | 先导入一份外部对话历史，任务成为它的下一轮 |
| `--session-id <id>` | 在已存的会话上续聊；每次运行都把会话 id 打到 stderr |
| `--context <json>` | 请求上下文：一个 JSON 对象，内联或放在文件里；随请求落日志，工具读取，模型看不到 |

`lyteboat run -h` 列出一次性模式的全部参数。

### 编写业务 agent

一个业务 agent 是一个目录 `lyteboat/agents/<id>/`，目录名就是 id：

- `agent.cordis.yml`（必需）：persona、技能路由、工具与策略等插件行；每一行只作用于这个 agent 的会话。
- `preset.yml`：显示名等展示信息。
- `skills/`：技能，每个技能一个 `SKILL.md`。
- `a2ui/`：卡片模板。
- `src/`：业务代码，编译到 `lib/`，由组合文件里的 `./lib/x.js` 行加载。

完整步骤和一个可运行的例子见[开发业务 agent](docs/03-agent-development.md)，现成的示例是 [`lyteboat/agents/finance`](lyteboat/agents/finance)：一个刻意做到最小、只为跑通端到端流程的金融智能体。

### 数据与会话日志

- 轻舟的全部数据在 `$LYTEBOAT_HOME` 下（默认 `~/.lyteboat`）。启动器在加载任何 dsh 包之前把它导出为 `DSH_HOME`，不会碰你自己的 `~/.dsh`。
- 会话日志是唯一的事实来源。卡片和状态增量记在 `tool/result.meta.lyteboat` 上，请求上下文和准入判定记在人类消息的 `source.lyteboatRequest` 上，路由选中的技能是 dsh 自己的技能调用消息，拒识回复是 `source.provider` 为 `lyteboat` 的助手消息，导入的历史是一串已关闭的普通 turn；旁路调用的审计 `lyteboat/aux-llm-call` 标为可忽略。所以这些会话可以被 dsh 自己的持久化层重新打开。
- `@lyteboat/host` 关掉了 dsh-base 的 `session-log-deepseek` 行：模型服务只收到请求本身。

## 文档

| 文档 | 内容 |
|---|---|
| [架构](docs/01-architecture.md) | C4 分层、启动时序、生命周期与依赖注入、一次请求的流程、会话日志的顺序 |
| [发行版约定](docs/02-distribution.md) | 内核与上游线、同步步骤、改动分类、晋升、各道闸门怎么跑、分支与通道、版本与钉法 |
| [开发业务 agent](docs/03-agent-development.md) | 从零写一个业务 agent（例子 `policy-desk`）：目录、组合、技能、工具、策略、测试、运行 |
| [参考实现对齐分析](docs/04-reference-alignment.md) | 参考实现的哪些能力要引入，core 怎样在保留 dsh 能力的前提下重新设计 |
| [兼容性承诺](dsh-compat/COMPAT.md)、[闸门总表](dsh-compat/README.md) | 轻舟对 dsh 插件的承诺，以及证明它的 G1–G6 |
| [CLAUDE.md](CLAUDE.md) | 在本仓库工作的约定：分层、提交、测试、同步规则 |
| [CHANGELOG](CHANGELOG.md) | 各里程碑交付了什么 |

## 项目结构

```
dsh/                  内核：dsh/kernel.json 列出的 13 个 dsh 包，沿用 @deepseek-ai/* 包名
lyteboat/                 轻舟自己的包，每层一个目录
  apps/               进程：lyteboat 启动器
  bundles/            组合：每个 profile 都带的 host，lyteboat run 用的 run
  plugins/            能力插件
  core/               声明与垫片
  agents/             业务 agent
  tooling/            测试支撑
dsh-compat/           兼容性承诺与证明：契约快照、扩展登记、G2/G4/G5/G6 测试
scripts/              分层检查、版本钉检查；dist/ 是发行版工具
docs/                 文档
dsh.upstream.json     所跟踪的 dsh 版本
```

依赖只能向下：`apps` → `bundles` → `plugins` → `core`；`agents` 只依赖 `plugins` 与 `core`；`tooling` 只给测试用。`pnpm run lint` 会检查。

| 路径 | 包 | 作用 |
|---|---|---|
| `lyteboat/apps/cli` | `@lyteboat/cli` | `lyteboat` 启动器：profile 模板、patch 叠加、启动（改编自 dsh 的 CLI） |
| `lyteboat/bundles/host` | `@lyteboat/host` | 每个 profile 都带的宿主 bundle：发行版标记与各能力插件的服务行 |
| `lyteboat/bundles/run` | `@lyteboat/run` | `lyteboat run` 背后的一次性 bundle：任务、`--agent`、`--agents`、`--history`、`--session-id`、`--context`；请求进循环前先准入，输出按轮组合卡片 |
| `lyteboat/plugins/distro` | `@lyteboat/distro` | `lyteboatDistro` 服务：内核来自哪个 dsh 版本、这次构建带了哪些内核扩展 |
| `lyteboat/plugins/tool-policy` | `@lyteboat/tool-policy` | 工具可见性、确认、状态增量；`./agent` 在 agent 的组合文件里声明策略 |
| `lyteboat/plugins/aux-llm` | `@lyteboat/aux-llm` | 旁路模型调用（技能路由、准入分类）：各自带超时，每次调用在会话里留一条可忽略的审计记录；在 `maxTokens` 处截断的回答算失败；`reasoningEffort` 配置旁路调用请求的推理强度 |
| `lyteboat/plugins/request-context` | `@lyteboat/request-context` | 请求上下文：一条人类消息所回应的请求（请求 id、上下文、准入判定）记在它自己的 source 上；`lyteboatRequest` 投影保存会话的上下文 |
| `lyteboat/plugins/intake-guard` | `@lyteboat/intake-guard` | 准入前移：agent 登记准入函数，调用方在请求进入循环前取得判定并记到请求上；循环里按记录的回复判定直接作答，没有经过准入的消息在循环内补做 |
| `lyteboat/plugins/skill-router` | `@lyteboat/skill-router` | 技能加载模式与模型路由；`./agent` 在 agent 的组合文件里声明模式 |
| `lyteboat/plugins/a2ui` | `@lyteboat/a2ui` | A2UI 模板引擎、`render_a2ui` 工具、`lyteboatCards` 投影；一个结果可带多张卡，按出卡模式（立即、延迟、延迟丢弃）和正文里的 `[[card:<区域>]]` 标记排进一轮（`turnParts`）；`./agent` 在组合文件里挂上这个工具 |
| `lyteboat/plugins/history-import` | `@lyteboat/history-import` | 外部对话历史的解析，以及 `lyteboat run --history` 用的会话种子 |
| `lyteboat/core/contracts` | `@lyteboat/contracts` | 轻舟在 dsh 接缝上的声明：工具与技能元数据、内核的 `lyteboat/*` 事件（再导出）、日志节点、`LyteboatDistro` |
| `lyteboat/core/cordis-compat` | `@lyteboat/cordis-compat` | cordis 发布物里被擦除的 const enum 的运行时取值 |
| `lyteboat/agents/finance` | `@lyteboat/agent-finance` | 金融智能体：刻意做到最小的示例业务 agent，只用公开理财常识。资产总览、按「100 减年龄」的配置诊断（两张卡）、三个概念的投资者教育，三个路由技能；请求进入循环前先准入（未授权出门槛卡、范围外拒识、投教与寒暄放行），客户由请求上下文指明 |
| `lyteboat/tooling/testing` | `@lyteboat/testing` | 测试支撑：dsh 服务挂载与 `MockAdapter`、会话日志读取、脚本化模型、启动器进程 |

## 开发

| 命令 | 作用 |
|---|---|
| `pnpm run build` | 编译全部包，并按上游方式打包内核 |
| `pnpm run test` | 构建、G1 契约检查、单元/组合/e2e 测试、上游内核测试（G2）；CI 跑的就是它 |
| `pnpm run lint` | oxlint、knip、分层检查、发行版清单检查 |
| `pnpm run typecheck` | 源码与测试的类型检查 |
| `pnpm run dsh-compat` | G4–G6：在仓库外装官方版与轻舟两棵安装树做对比（需要联网） |
| `pnpm run check` | lint + test + dsh-compat |
| `pnpm run dist:delta` | 列出轻舟在所导入的 dsh tag 之上带了哪些改动 |

同步新的 dsh 版本、把包晋升进内核、跑 G3 与持久化闸门，见[发行版约定](docs/02-distribution.md)。

### pnpm 设置为什么和常见项目不同

- **增删或移动工作区包之后，从干净的 `node_modules` 重装。** 增量 `pnpm install` 会留下过期的提升链接。
- **`publicHoistPattern: ['@deepseek-ai/*', '@lyteboat/*']`。** agent 的组合文件按裸包名引用插件行，从 agent 目录向上解析；组合测试从仓库根解析。在 pnpm 的隔离布局下，两者都只能在根 `node_modules` 找到 dsh 与轻舟的包。启动器自己则通过 dsh 的运行时解析，按 `lyteboat/apps/cli` 的依赖图找插件行。
- **`overrides`。** 每个内核包名都指向 `dsh/` 下的工作区副本，轻舟自己的包和依赖它的每个 npm 包都一样，所以依赖图里每个内核包只有一份，就是轻舟的。`rolldown` 固定在上游 lockfile 解析出的版本，内核打包才能和 npm 发布物逐字节相同。
- **`.pnpmfile.cjs`。** 发布的 dsh 包之间用 `^` 范围互相依赖，不钉的话会漂到比所跟踪 tag 更新的预发布版本。它不碰内核包名：它在 overrides 之后运行，会把 overrides 撤掉。
- **dsh peer 写精确版本。** 轻舟的包对非内核 dsh 包的 peer 写所跟踪版本的精确版本号，不写 `catalog:dsh`：dsh 启动时从磁盘上的清单读插件行的 dsh peer，pnpm 不会解析那里的 `catalog:`，对不上的行会被禁用。`scripts/upstream-pins.spec.ts` 保证它们等于 `dsh.upstream.json`。
- **`minimumReleaseAgeExclude`。** pnpm 11 拒绝安装发布不满一天的包；新钉的 dsh 版本按精确版本列在这里，发布满一天后可以删掉。
- **`allowBuilds`。** pnpm 11 默认拦截安装脚本；在 Linux/macOS 上只需要放行 node-pty 的 chmod。

## 状态与路线图

- 跟踪 dsh **0.1.7-rc.1**（`dsh.upstream.json`）。内核是它的导入，加上轻舟登记的三个扩展（`lyteboat/intake`、`lyteboat/pre-assemble`、`session-append-ignorable`），上面所有闸门都对它通过。
- 已交付：启动器与 profile；业务能力插件 tool-policy、skill-router、a2ui、aux-llm、request-context、intake-guard、history-import；金融智能体；续聊（`--session-id`）与请求上下文（`--context`）；发行版工具与 13 包内核；兼容性闸门 G1–G6。里程碑明细见 [CHANGELOG](CHANGELOG.md)。
- 已知限制：
  - 还没有对外服务模式（`/chat`、多用户）；`lyteboat web` 不读 agent 目录，经它进来的消息在循环内补做准入，不记录判定。
  - 还没有记忆、推荐问，也不能按 agent 分别配置业务模型和旁路模型。
- 下一步见[对齐分析的路线图](docs/04-reference-alignment.md#6-路线图从-d3-开始)。

## 参与贡献

- 先读 [CLAUDE.md](CLAUDE.md)：分层规则、测试要求、提交信息格式。`dsh/` 下的改动必须是带 `Dist-Change:` trailer 的分类提交；动 `dsh/` 之前先读[兼容性承诺](dsh-compat/COMPAT.md)。
- 提交前跑 `pnpm run lint`、`pnpm run typecheck`、`pnpm run test`；改了内核或兼容面，再跑 `pnpm run dsh-compat`。
- 仓库外的插件如果要用轻舟的扩展，声明 `inject: ['lyteboatDistro']`，这样它在官方 dsh 上不会加载。
- 合并 PR 请用 merge commit，不要 squash 或 rebase：上游线靠导入提交的 `Dist-Import` trailer 查找。

## 许可证

轻舟以 [MIT 许可证](LICENSE) 发布。`dsh/` 下的内核包，以及文件头标注 "Adapted from deepseek-ai/deepseek-harness" 的文件，保留 DeepSeek 的 MIT 版权声明，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 致谢

轻舟构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与它的 Cordis 插件系统之上。
