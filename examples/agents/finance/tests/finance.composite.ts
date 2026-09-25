/**
 * The finance agent in the run composition (in process, scripted DeepSeek
 * Messages server): each request names its customer in `--context` and is
 * admitted before the loop (the unauthorized card and the service scope
 * answer without the model); the persona is the whole system prompt, the
 * official tools are narrowed away, the routed skill's tool alone reaches the
 * model at temperature 0, and the cards are placed where the answer marks
 * them. A routed session reopens under dsh's persistence, and `--session-id`
 * continues it in a new process with the context it began with.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { SessionFormatUnsupportedError, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'
import { bootComposition } from '@lyteboat/testing/composition'
import { findSessionLogs, readSessionLog } from '@lyteboat/testing/session-log'
import { startScriptedModel, withTitle, type ChatBlock, type RecordedRequest, type ScriptedModel } from '@lyteboat/testing/scripted-model'

/** The examples/agents root this package lives in, as `--agents ./examples/agents` names it. */
const AGENTS = fileURLToPath(new URL('../..', import.meta.url))
const RUN_BUNDLES = ['@deepseek-ai/dsh-base', '@lyteboat/host', '@lyteboat/run']

/** The skill and tool call each task routes to. */
const PLANS: Record<string, { skill: string; tool: string; args?: Record<string, unknown> }> = {
  看看我的资产: { skill: 'asset-overview', tool: 'asset_overview' },
  我的配置合理吗: { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis' },
  什么是再平衡: { skill: 'investor-education', tool: 'lookup_knowledge', args: { topic: '再平衡' } },
}

const FINANCE_TOOLS = ['asset_overview', 'allocation_diagnosis', 'lookup_knowledge']

interface LogRecord { type: string; seq?: number; id?: string; createdAt?: number; isSeeded?: boolean; ignorable?: true; data?: Record<string, unknown> }

function blockText(block: ChatBlock): string {
  return block.text ?? (Array.isArray(block.content) ? (block.content as ChatBlock[]).map(blockText).join('') : '')
}

/** The text of the latest tool result in a request. */
function lastToolResult(request: RecordedRequest): string {
  const results = request.body.messages.flatMap(message => message.content.filter(block => block.type === 'tool_result'))
  return results.map(blockText).at(-1) ?? ''
}

/** Why dsh's persistence would refuse to reopen the stored log; undefined when it reopens. */
function reopenRefusal(records: LogRecord[]): string | undefined {
  const header = records.find(record => record.type === 'session')
  try {
    validateStoredEvents(
      { id: SessionId(header?.id ?? 'reopen'), version: SESSION_FORMAT_VERSION, createdAt: header?.createdAt ?? 0, isSeeded: header?.isSeeded ?? false },
      structuredClone(records.filter(record => typeof record.seq === 'number')) as never,
      undefined,
    )
    return undefined
  } catch (error: unknown) {
    if (!(error instanceof SessionFormatUnsupportedError)) throw error
    return error.message
  }
}

/** The finance admission's classifier call: the scripted model sees it as a loop request with its own system text. */
const isIntake = (request: RecordedRequest): boolean => request.systemText.includes('准入分类器')
const isLoop = (request: RecordedRequest): boolean => request.purpose === 'loop' && !isIntake(request)

function script(request: RecordedRequest) {
  if (isIntake(request)) {
    const latest = /<latest>([\s\S]*?)<\/latest>/u.exec(request.lastUser)?.[1] ?? ''
    const plan = PLANS[latest]
    return { text: JSON.stringify({ intent: plan === undefined ? 'other' : plan.skill === 'investor-education' ? 'education' : 'asset', reason: 'test' }) }
  }
  if (request.purpose === 'router') {
    const latest = /<latest_user_input>([\s\S]*?)<\/latest_user_input>/u.exec(request.lastUser)?.[1] ?? ''
    return { text: JSON.stringify({ skill_id: PLANS[latest]?.skill ?? null, reason: 'test' }) }
  }
  const plan = Object.values(PLANS).find(candidate => request.toolNames.includes(candidate.tool))
  if (plan !== undefined && !request.calledTools.includes(plan.tool)) return { toolCall: { name: plan.tool, arguments: plan.args ?? {}, id: `call-${plan.tool}` } }
  const areas = /areas=([^\]\s]+)/u.exec(lastToolResult(request))?.[1] ?? 'none'
  const markers = areas === 'none' ? [] : areas.split(',').map(area => `[[card:${area}]]`)
  return { text: ['FINANCE-OK', ...markers].join('\n') }
}

describe('finance agent in the run composition (in process, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'lyteboat-finance-'))
    model = await startScriptedModel(withTitle(script), { apiKey: 'mock-key' })
  })

  afterAll(async () => {
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  async function run(label: string, customer: string | undefined, task: string, extra: string[] = []): Promise<{ requests: RecordedRequest[]; records: LogRecord[]; stdout: string; home: string }> {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# finance\n')
    const before = model.requests.length
    const result = await bootComposition({
      bundles: RUN_BUNDLES,
      args: ['--agents', AGENTS, '--agent', 'finance', ...customer === undefined ? [] : ['--context', JSON.stringify({ customer })], ...extra, task],
      cwd: workspace,
      home,
      env: { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    })
    expect(result.code, result.stderr).toBe(0)
    const [log] = findSessionLogs(home)
    return { requests: model.requests.slice(before), records: readSessionLog(log!) as unknown as LogRecord[], stdout: result.stdout, home }
  }

  const resultMeta = (records: LogRecord[]) => records.find(record => record.type === 'tool/result')?.data?.['meta'] as {
    lyteboat?: { cards?: { area: string; emission: string; surfaceId: string }[] }
  } | undefined

  it('"看看我的资产": the persona is the whole system prompt and only the routed tool reaches the model, at temperature 0', async () => {
    const { requests, records, stdout } = await run('overview', 'young-idle-cash', '看看我的资产')
    // The answer's marker became the card's place: the terminal prints it as a line of its own.
    expect(stdout).toBe('FINANCE-OK\n[card asset_overview]\n')
    const loop = requests.filter(isLoop)
    expect(loop).toHaveLength(2)
    expect(loop[0]!.body.system).toContain('你是「轻舟金融助手」')
    expect(loop[0]!.body.system).not.toContain('coding agent')
    expect(loop[0]!.toolNames.filter(name => FINANCE_TOOLS.includes(name))).toEqual(['asset_overview'])
    expect(loop[0]!.toolNames.filter(name => !FINANCE_TOOLS.includes(name))).toEqual(['skill'])
    expect(loop[0]!.body['temperature']).toBe(0)
    expect(lastToolResult(loop[1]!)).toContain('【事实】\n- 已授权资产合计 80,000.00 元（约 8.00 万元）')
    expect(lastToolResult(loop[1]!)).toContain('【不可答】')
    expect(resultMeta(records)?.lyteboat?.cards).toEqual([expect.objectContaining({ area: 'asset_overview', emission: 'deferred', surfaceId: expect.stringMatching(/^asset_overview-/u) as string })])
  })

  it('"我的配置合理吗": the diagnosis prepares two cards, and the answer places both', async () => {
    const { requests, records, stdout } = await run('diagnosis', 'midlife-moderate', '我的配置合理吗')
    const digest = lastToolResult(requests.filter(isLoop)[1]!)
    expect(digest).toMatch(/^\[tool:allocation_diagnosis status=ok verdict=balanced areas=allocation_diagnosis,allocation_plan\]/u)
    expect(digest).toContain('风险资产占 45.0%；按「100 减年龄」，45 岁的建议区间是 45%–65%')
    expect(resultMeta(records)?.lyteboat?.cards?.map(card => [card.area, card.emission])).toEqual([['allocation_diagnosis', 'deferred'], ['allocation_plan', 'deferred']])
    expect(stdout).toBe('FINANCE-OK\n[card allocation_diagnosis]\n[card allocation_plan]\n')
  })

  it('nothing authorized: the admission answers with the unauthorized card before the loop', async () => {
    const { requests, records, stdout } = await run('unauthorized', 'none-authorized', '看看我的资产')
    expect(requests.filter(isIntake)).toHaveLength(1)
    expect(requests.filter(isLoop)).toEqual([])
    expect(requests.filter(request => request.purpose === 'router')).toEqual([])
    expect(stdout).toBe('[card unauthorized]\n您还没有授权任何账户，授权后我就能帮您看资产了。\n')
    const human = records.find(record => record.type === 'user/message' && (record.data?.['source'] as { kind?: unknown } | undefined)?.kind === 'user')
    expect(human?.data?.['source']).toMatchObject({ lyteboatRequest: { context: { customer: 'none-authorized' }, intake: { by: 'finance-admission', decision: 'reply', verdict: 'unauthorized' } } })
    expect(records.filter(record => record.type === 'turn/end')).toHaveLength(1)
  })

  it('out of scope: the admission answers with the service scope, no router and no loop request', async () => {
    const { requests, stdout } = await run('scope', 'midlife-moderate', '帮我写一首诗')
    expect(requests.filter(request => request.purpose === 'router' || isLoop(request))).toEqual([])
    expect(stdout).toBe('这个问题不在我的服务范围内。我可以帮您看看资产、诊断配置，或者讲讲理财常识。\n')
  })

  it('no customer in the context: investor education is still admitted, a question about money gets the no-customer reply', async () => {
    const education = await run('education-anonymous', undefined, '什么是再平衡')
    expect(education.stdout).toBe('FINANCE-OK\n')
    expect(lastToolResult(education.requests.filter(isLoop)[1]!)).toContain('再平衡是定期把各类资产的比例调回目标')

    const money = await run('money-anonymous', undefined, '看看我的资产')
    expect(money.requests.filter(isLoop)).toEqual([])
    expect(money.stdout).toBe('暂时没能识别您的身份，请从已登录的入口进来后再试。\n')
  })

  it('a customer the source does not know gets the no-customer reply instead of a failed run', async () => {
    const { requests, stdout } = await run('unknown-customer', 'nobody-here', '看看我的资产')
    expect(requests.filter(isLoop)).toEqual([])
    expect(stdout).toBe('暂时没能识别您的身份，请从已登录的入口进来后再试。\n')
  })

  it('"什么是再平衡": investor education answers from the knowledge base without a card', async () => {
    const { requests, records } = await run('education', 'midlife-moderate', '什么是再平衡')
    expect(lastToolResult(requests.filter(isLoop)[1]!)).toContain('再平衡是定期把各类资产的比例调回目标')
    expect(resultMeta(records)?.lyteboat).toBeUndefined()
  })

  it('imported history: the admission classifier sees the imported questions beside their answers', async () => {
    const history = join(root, 'history.json')
    writeFileSync(history, JSON.stringify({ context: { history: [
      { channel: 'app', createTime: '2026-09-20 10:00:00', role: 'user', traceId: 'trace-0001', parts: [{ type: 'text', text: '帮我看看我的资产' }] },
      { channel: 'app', createTime: '2026-09-20 10:00:06', role: 'assistant', traceId: 'trace-0001', parts: [{ type: 'text', text: '您的资产合计 8 万元。' }] },
    ] } }))
    const { requests } = await run('history', 'young-idle-cash', '我的配置合理吗', ['--history', history])
    expect(requests.find(isIntake)?.lastUser).toContain('<conversation>\n用户：帮我看看我的资产\n助手：您的资产合计 8 万元。\n</conversation>')
  })

  it('a routed session reopens under dsh persistence: every fact rides a dsh envelope, the side calls ignorable records', async () => {
    const { records } = await run('reopen', 'young-idle-cash', '看看我的资产')
    expect(reopenRefusal(records)).toBeUndefined()
    const own = records.filter(record => record.type.startsWith('lyteboat/'))
    expect(own.map(record => [record.type, record.ignorable, record.data?.['purpose']])).toEqual([['lyteboat/aux-llm-call', true, 'intake'], ['lyteboat/aux-llm-call', true, 'skill-router']])
  })

  it('--session-id continues in a new process: the diagnosis turn keeps the customer and sees the overview it already gave', async () => {
    const home = join(root, 'home-continue')
    const workspace = join(root, 'workspace-continue')
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# finance\n')
    const boot = (args: string[]) => bootComposition({
      bundles: RUN_BUNDLES,
      args: ['--agents', AGENTS, '--agent', 'finance', ...args],
      cwd: workspace,
      home,
      env: { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    })
    // Only the first request names the customer: the continued session keeps its context.
    const first = await boot(['--context', '{"customer":"young-idle-cash"}', '看看我的资产'])
    expect(first.code, first.stderr).toBe(0)
    const id = /^lyteboat: session (\S+)$/mu.exec(first.stderr)?.[1] ?? ''
    const before = model.requests.length

    const second = await boot(['--session-id', id, '我的配置合理吗'])
    expect(second.code, second.stderr).toBe(0)
    const loop = model.requests.slice(before).filter(isLoop)
    expect(loop[0]!.toolNames.filter(name => FINANCE_TOOLS.includes(name))).toEqual(['allocation_diagnosis'])
    const earlier = loop[0]!.body.messages.flatMap(message => message.content.filter(block => block.type === 'tool_result')).map(blockText)
    expect(earlier).toHaveLength(1)
    expect(earlier[0]).toMatch(/^\[tool:asset_overview status=ok areas=asset_overview\]/u)
    expect(lastToolResult(loop[1]!)).toMatch(/^\[tool:allocation_diagnosis status=ok verdict=cautious /u)
    const [log] = findSessionLogs(home)
    const records = readSessionLog(log!) as unknown as LogRecord[]
    expect(records.filter(record => record.type === 'turn/start')).toHaveLength(2)
    expect(reopenRefusal(records)).toBeUndefined()
  })
})
