/**
 * Every session boat writes through a dsh envelope reopens under dsh's own
 * persistence validator: the intake reply, a tool result carrying a state
 * delta and a card, and an imported history. A routed session is the known
 * exception (`boat/skill-routed` has no dsh envelope) and is pinned here so
 * the limitation is visible the day it disappears.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { SessionFormatUnsupportedError, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findSessionLogs, readSessionLog } from '@boat/testing/session-log'
import { runBoat } from './support/boat-process.ts'
import { startScriptedModel, withTitle, type RecordedRequest, type ScriptedModel } from '@boat/testing/scripted-model'

const EXAMPLES = fileURLToPath(new URL('../../../examples', import.meta.url))
const AGENTS = fileURLToPath(new URL('./fixtures/agents', import.meta.url))
const ASSET_SKILL = `---
name: asset-overview
description: 资产总览。
---
ASSET-OVERVIEW-BODY
`

interface StoredRecord { type: string; seq?: number; id?: string; createdAt?: number; isSeeded?: boolean }

function calledTools(request: RecordedRequest): string {
  return JSON.stringify(request.body.messages.filter(message => message.role === 'assistant').map(message => message.tool_calls))
}

/** The loop calls each named tool once, in order, then answers; the router always picks the first candidate. */
function script(tools: string[]) {
  return withTitle((request: RecordedRequest) => {
    if (request.purpose === 'router') return { text: JSON.stringify({ skill_id: 'asset-overview', reason: 'test' }) }
    const called = calledTools(request)
    const next = tools.find(name => !called.includes(name))
    return next === undefined ? { text: 'REOPEN-OK' } : { toolCall: { name: next, arguments: {}, id: `call-${next}` } }
  })
}

/** Reopen the stored log the way dsh's persistence does before it interprets one. */
function reopen(home: string): { types: string[]; refusal: string | undefined } {
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
    return { types: events.map(event => event.type), refusal: undefined }
  } catch (error: unknown) {
    if (!(error instanceof SessionFormatUnsupportedError)) throw error
    return { types: events.map(event => event.type), refusal: error.message }
  }
}

describe('boat sessions reopen under dsh session persistence (built bin, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'boat-reopen-'))
    model = await startScriptedModel(script(['lookup_assets', 'query_assets']), { apiKey: 'mock-key' })
  })

  afterAll(async () => {
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  async function run(label: string, args: string[]): Promise<{ types: string[]; refusal: string | undefined }> {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# reopen\n')
    mkdirSync(join(workspace, '.dsh/skills/asset-overview'), { recursive: true })
    writeFileSync(join(workspace, '.dsh/skills/asset-overview/SKILL.md'), ASSET_SKILL)
    const result = await runBoat(['run', '--driver', 'boat', ...args], {
      cwd: workspace,
      env: { BOAT_HOME: home, DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    })
    expect(result.code, result.stderr).toBe(0)
    return reopen(home)
  }

  it('an intake reply: the reply is an assistant message and nothing else', async () => {
    const { types, refusal } = await run('intake', ['--plugin', join(EXAMPLES, 'intake-gate', 'plugin.mjs'), '帮我炒股'])
    expect(refusal).toBeUndefined()
    expect(types).toContain('assistant/message')
    expect(types.filter(type => type.startsWith('boat/'))).toEqual([])
  })

  it('a state delta and a card: both ride tool/result.meta', async () => {
    const { types, refusal } = await run('tools', ['--plugin', join(EXAMPLES, 'tools', 'plugin.mjs'), '--plugin', join(EXAMPLES, 'a2ui', 'plugin.mjs'), '看看我的资产'])
    expect(refusal).toBeUndefined()
    expect(types.filter(type => type === 'tool/result').length).toBeGreaterThanOrEqual(1)
    expect(types.filter(type => type.startsWith('boat/'))).toEqual([])
  })

  it('an imported history: the seed is closed turns of dsh nodes', async () => {
    const { types, refusal } = await run('history', ['--history', join(EXAMPLES, 'history', 'sa.json'), '继续刚才的话题'])
    expect(refusal).toBeUndefined()
    expect(types).toContain('session/end-seed')
    expect(types.filter(type => type.startsWith('boat/'))).toEqual([])
  })

  it('a routed session is refused: boat/skill-routed has no dsh envelope yet (known limitation, see @boat/contracts)', async () => {
    const { types, refusal } = await run('routed', ['--agents', AGENTS, '--preset', 'routed', '看看资产'])
    expect(types).toContain('boat/skill-routed')
    expect(refusal).toMatch(/"boat\/(skill-routed|route-request)".*not marked ignorable/u)
  })
})
