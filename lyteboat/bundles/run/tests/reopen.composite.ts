/**
 * Every session lyteboat writes reopens under dsh's own persistence validator,
 * because every lyteboat fact rides a dsh envelope: the intake reply, a tool
 * result carrying a state delta and a card, an imported history, and a routed
 * skill (dsh's own skill-invocation message). The router call's audit record
 * is lyteboat's own type, appended ignorable, so the validator skips it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { SessionFormatUnsupportedError, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pluginFileRow, type PatchOptions } from '@lyteboat/testing/composition'
import { findSessionLogs, readSessionLog } from '@lyteboat/testing/session-log'
import { FIXTURES, runComposition } from './support/run-composition.ts'
import { startScriptedModel, withTitle, type RecordedRequest, type ScriptedModel } from '@lyteboat/testing/scripted-model'

const PLUGINS = join(FIXTURES, 'plugins')
const AGENTS = join(FIXTURES, 'agents')
const ASSET_SKILL = `---
name: asset-overview
description: 资产总览。
---
ASSET-OVERVIEW-BODY
`

interface StoredRecord { type: string; seq?: number; id?: string; createdAt?: number; isSeeded?: boolean; ignorable?: true }

/** The loop calls each named tool once, in order, then answers; the router always picks the first candidate. */
function script(tools: string[]) {
  return withTitle((request: RecordedRequest) => {
    if (request.purpose === 'router') return { text: JSON.stringify({ skill_id: 'asset-overview', reason: 'test' }) }
    const next = tools.find(name => !request.calledTools.includes(name))
    return next === undefined ? { text: 'REOPEN-OK' } : { toolCall: { name: next, arguments: {}, id: `call-${next}` } }
  })
}

/** Reopen the stored log the way dsh's persistence does before it interprets one. */
function reopen(home: string): { types: string[]; ignorable: string[]; refusal: string | undefined } {
  const [log] = findSessionLogs(home)
  const records = readSessionLog(log!) as unknown as StoredRecord[]
  const header = records.find(record => record.type === 'session')
  const events = records.filter(record => typeof record.seq === 'number')
  try {
    validateStoredEvents(
      { id: SessionId(header?.id ?? 'reopen'), version: SESSION_FORMAT_VERSION, createdAt: header?.createdAt ?? 0, isSeeded: header?.isSeeded ?? false },
      structuredClone(events) as never,
      undefined,
    )
    return { types: events.map(event => event.type), ignorable: events.filter(event => event.ignorable === true).map(event => event.type), refusal: undefined }
  } catch (error: unknown) {
    if (!(error instanceof SessionFormatUnsupportedError)) throw error
    return { types: events.map(event => event.type), ignorable: events.filter(event => event.ignorable === true).map(event => event.type), refusal: error.message }
  }
}

describe('lyteboat sessions reopen under dsh session persistence (in process, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'lyteboat-reopen-'))
    model = await startScriptedModel(script(['lookup_assets', 'query_profile']), { apiKey: 'mock-key' })
  })

  afterAll(async () => {
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  async function run(label: string, args: string[], patches: PatchOptions[] = []): Promise<{ types: string[]; ignorable: string[]; refusal: string | undefined }> {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# reopen\n')
    mkdirSync(join(workspace, '.dsh/skills/asset-overview'), { recursive: true })
    writeFileSync(join(workspace, '.dsh/skills/asset-overview/SKILL.md'), ASSET_SKILL)
    const result = await runComposition(args, {
      cwd: workspace,
      home,
      env: { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    }, patches)
    expect(result.code, result.stderr).toBe(0)
    return reopen(home)
  }

  it('an intake reply: the reply is an assistant message and nothing else', async () => {
    const { types, refusal } = await run('intake', ['帮我炒股'], [pluginFileRow(join(PLUGINS, 'intake-gate.mjs'))])
    expect(refusal).toBeUndefined()
    expect(types).toContain('assistant/message')
    expect(types.filter(type => type.startsWith('lyteboat/'))).toEqual([])
  })

  it('a state delta and a card: both ride tool/result.meta', async () => {
    const { types, refusal } = await run('tools', ['看看我的资产'], [pluginFileRow(join(PLUGINS, 'tools.mjs')), pluginFileRow(join(PLUGINS, 'a2ui', 'plugin.mjs'))])
    expect(refusal).toBeUndefined()
    expect(types.filter(type => type === 'tool/result').length).toBeGreaterThanOrEqual(1)
    expect(types.filter(type => type.startsWith('lyteboat/'))).toEqual([])
  })

  it('an imported history: the seed is closed turns of dsh nodes', async () => {
    const { types, refusal } = await run('history', ['--history', join(FIXTURES, 'history', 'rounds.json'), '继续刚才的话题'])
    expect(refusal).toBeUndefined()
    expect(types).toContain('session/end-seed')
    expect(types.filter(type => type.startsWith('lyteboat/'))).toEqual([])
  })

  it('a routed session: the skill arrives as a skill-invocation user message, the router call as an ignorable record', async () => {
    const { types, ignorable, refusal } = await run('routed', ['--agents', AGENTS, '--agent', 'routed', '看看资产'])
    expect(refusal).toBeUndefined()
    expect(types).toContain('user/message')
    expect(types.filter(type => type.startsWith('lyteboat/'))).toEqual(['lyteboat/aux-llm-call'])
    expect(ignorable).toEqual(['lyteboat/aux-llm-call'])
  })
})
