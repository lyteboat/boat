/**
 * The finance agent in the run composition (in process, scripted DeepSeek
 * Messages server): the persona is the whole system prompt, the official
 * tools are narrowed away, the routed skill's tool alone reaches the model at
 * temperature 0, cards ride the tool result, and the unauthorized card ends
 * the turn. A routed session reopens under dsh's persistence, and
 * `--session-id` continues it in a new process.
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

/** The agents/ root this package lives in, as `--agents ./agents` names it. */
const AGENTS = fileURLToPath(new URL('../..', import.meta.url))
const RUN_BUNDLES = ['@deepseek-ai/dsh-base', '@lyteboat/host', '@lyteboat/run']

/** The skill and tool call each task routes to. */
const PLANS: Record<string, { skill: string; tool: string; args?: Record<string, unknown> }> = {
  看看我的资产: { skill: 'asset-overview', tool: 'asset_overview' },
  我的配置合理吗: { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis' },
  什么是再平衡: { skill: 'investor-education', tool: 'lookup_knowledge', args: { topic: '再平衡' } },
}

const FINANCE_TOOLS = ['asset_overview', 'allocation_diagnosis', 'bucket_diagnosis', 'lookup_knowledge']

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

function script(request: RecordedRequest) {
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

  async function run(label: string, customer: string, task: string): Promise<{ requests: RecordedRequest[]; records: LogRecord[]; stdout: string; home: string }> {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# finance\n')
    const before = model.requests.length
    const result = await bootComposition({
      bundles: RUN_BUNDLES,
      args: ['--agents', AGENTS, '--agent', 'finance', task],
      cwd: workspace,
      home,
      env: { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1', LYTEBOAT_FINANCE_CUSTOMER: customer },
    })
    expect(result.code, result.stderr).toBe(0)
    const [log] = findSessionLogs(home)
    return { requests: model.requests.slice(before), records: readSessionLog(log!) as unknown as LogRecord[], stdout: result.stdout, home }
  }

  const resultMeta = (records: LogRecord[]) => records.find(record => record.type === 'tool/result')?.data?.['meta'] as {
    lyteboat?: { cards?: { area: string; emission: string; surfaceId: string }[] }
    finance?: { state?: Record<string, unknown> }
  } | undefined

  it('"看看我的资产": the persona is the whole system prompt and only the routed tool reaches the model, at temperature 0', async () => {
    const { requests, records, stdout } = await run('overview', 'young-idle-cash', '看看我的资产')
    // The answer's marker became the card's place: the terminal prints it as a line of its own.
    expect(stdout).toBe('FINANCE-OK\n[card asset_overview]\n')
    const loop = requests.filter(request => request.purpose === 'loop')
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

  it('"我的配置合理吗": a rich diagnosis prepares two cards and asks for the investment horizon', async () => {
    const { requests, records, stdout } = await run('diagnosis', 'midlife-moderate', '我的配置合理吗')
    const digest = lastToolResult(requests.filter(request => request.purpose === 'loop')[1]!)
    expect(digest).toMatch(/^\[tool:allocation_diagnosis status=ok state=rich seq=1 areas=allocation_diagnosis,allocation_plan\]/u)
    expect(digest).toContain('稳健投资 146,000.00 元（约 14.60 万元），占 73.0%，建议 15%–25%，偏高')
    expect(digest).toContain('大概多久用不到')
    const meta = resultMeta(records)
    expect(meta?.lyteboat?.cards?.map(card => [card.area, card.emission])).toEqual([['allocation_diagnosis', 'deferred'], ['allocation_plan', 'deferred']])
    expect(meta?.finance?.state).toMatchObject({ diagnosisSeq: 1, asked: ['investmentHorizon'] })
    expect(stdout).toBe('FINANCE-OK\n[card allocation_diagnosis]\n[card allocation_plan]\n')
  })

  it('nothing authorized: the unauthorized card ends the turn after one model request', async () => {
    const { requests, records, stdout } = await run('unauthorized', 'none-authorized', '看看我的资产')
    expect(requests.filter(request => request.purpose === 'loop')).toHaveLength(1)
    expect(resultMeta(records)?.lyteboat?.cards?.[0]).toMatchObject({ area: 'unauthorized', emission: 'immediate' })
    expect(stdout).toBe('[card unauthorized]\n')
    expect(records.filter(record => record.type === 'turn/end')).toHaveLength(1)
  })

  it('"什么是再平衡": investor education answers from the knowledge base without a card', async () => {
    const { requests, records } = await run('education', 'healthy', '什么是再平衡')
    expect(lastToolResult(requests.filter(request => request.purpose === 'loop')[1]!)).toContain('再平衡是定期把各类资产的比例调回目标')
    expect(resultMeta(records)?.lyteboat).toBeUndefined()
  })

  it('a routed session reopens under dsh persistence: every fact rides a dsh envelope, the router call an ignorable record', async () => {
    const { records } = await run('reopen', 'young-idle-cash', '看看我的资产')
    expect(reopenRefusal(records)).toBeUndefined()
    const own = records.filter(record => record.type.startsWith('lyteboat/'))
    expect(own.map(record => [record.type, record.ignorable, record.data?.['purpose']])).toEqual([['lyteboat/aux-llm-call', true, 'skill-router']])
  })

  it('--session-id continues in a new process: the diagnosis turn sees the overview aged to its facts', async () => {
    const home = join(root, 'home-continue')
    const workspace = join(root, 'workspace-continue')
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# finance\n')
    const boot = (args: string[]) => bootComposition({
      bundles: RUN_BUNDLES,
      args: ['--agents', AGENTS, '--agent', 'finance', ...args],
      cwd: workspace,
      home,
      env: { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1', LYTEBOAT_FINANCE_CUSTOMER: 'young-idle-cash' },
    })
    const first = await boot(['看看我的资产'])
    expect(first.code, first.stderr).toBe(0)
    const id = /^lyteboat: session (\S+)$/mu.exec(first.stderr)?.[1] ?? ''
    const before = model.requests.length

    const second = await boot(['--session-id', id, '我的配置合理吗'])
    expect(second.code, second.stderr).toBe(0)
    const loop = model.requests.slice(before).filter(request => request.purpose === 'loop')
    expect(loop[0]!.toolNames.filter(name => FINANCE_TOOLS.includes(name))).toEqual(['allocation_diagnosis'])
    const earlier = loop[0]!.body.messages.flatMap(message => message.content.filter(block => block.type === 'tool_result')).map(blockText)
    expect(earlier).toHaveLength(1)
    expect(earlier[0]).toMatch(/^\[tool:asset_overview 已完成 status=ok/u)
    expect(earlier[0]).toContain('【事实】')
    expect(earlier[0]).not.toContain('【回答要点】')
    expect(lastToolResult(loop[1]!)).toMatch(/^\[tool:allocation_diagnosis status=ok /u)
    const [log] = findSessionLogs(home)
    const records = readSessionLog(log!) as unknown as LogRecord[]
    expect(records.filter(record => record.type === 'turn/start')).toHaveLength(2)
    expect(reopenRefusal(records)).toBeUndefined()
  })
})
