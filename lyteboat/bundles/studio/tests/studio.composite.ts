/**
 * The studio composition in process (dsh-base, @lyteboat/host,
 * @lyteboat/business-base, @lyteboat/studio) over fixture agents: an operator's
 * accounts sign in, the radar lists the agent that mounted and the one that
 * failed, roles gate the Users endpoints and a reload, the System page answers,
 * the pages are served at /studio, and neither /chat nor dsh's session channel is served. A Studio without
 * accounts refuses to start and names the command that makes one.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setStudioAccount, setStudioGrant } from '@lyteboat/studio-auth/accounts'
import { LYTEBOAT_STUDIO_BUNDLES, bootComposition, startComposition, type RunningComposition } from '@lyteboat/testing/composition'
import { createLyteboatScratch } from '@lyteboat/testing/scratch'

const AGENTS = fileURLToPath(new URL('./fixtures/agents', import.meta.url))

describe('lyteboat studio (in process)', () => {
  const scratch = createLyteboatScratch('studio')
  let studio: RunningComposition
  let origin: string

  async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${origin}/api/studio/${path}`, {
      method,
      headers: { ...token === undefined ? {} : { authorization: `Bearer ${token}` }, ...body === undefined ? {} : { 'content-type': 'application/json' } },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
    })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }

  async function login(username: string, password: string): Promise<string> {
    const answer = await call('POST', 'auth/login', undefined, { username, password })
    expect(answer.status).toBe(200)
    return answer.body['token'] as string
  }

  beforeAll(async () => {
    const run = scratch.run('studio')
    setStudioAccount(join(run.home, 'studio'), 'root', { password: 'pw-root', displayName: 'Root' })
    setStudioGrant(join(run.home, 'studio'), 'root', 'admin', 'cli')
    setStudioAccount(join(run.home, 'studio'), 'vera', { password: 'pw-vera' })
    setStudioGrant(join(run.home, 'studio'), 'vera', 'viewer', 'cli')
    studio = startComposition({
      bundles: LYTEBOAT_STUDIO_BUNDLES,
      // A row resolves its package from its agent directory, so the inspected agents stay in the repository.
      args: ['--agents', AGENTS, '--port', '0'],
      cwd: run.workspace,
      home: run.home,
      env: {},
      timeoutMs: 170_000,
    })
    const [, port] = await studio.waitForStdout(/^lyteboat studio: http:\/\/127\.0\.0\.1:(\d+)\/studio\/ \(internal sign-in\)$/mu) as unknown as [string, string]
    origin = `http://127.0.0.1:${port}`
    await studio.waitForStdout(/^lyteboat studio: agents helper$/mu)
  })

  afterAll(async () => {
    await studio.stop()
    scratch.remove()
  })

  it('signs an operator\'s account in and lists the agents, the failed one with why', async () => {
    const admin = await login('root', 'pw-root')

    const agents = await call('GET', 'agents', admin)

    expect(agents.body).toMatchObject({
      agents: [{ id: 'helper', name: 'Helper', version: '0.1.0', digest: expect.stringMatching(/^sha256:/u), deviates: false }],
      failures: [{ id: 'broken', reason: expect.stringContaining('@lyteboat/no-such-plugin') }],
    })
    expect(studio.stderr()).toContain('lyteboat studio: agent broken failed:')
  })

  it('keeps the Users endpoints and a reload to admins, and answers the System page for any role', async () => {
    const viewer = await login('vera', 'pw-vera')
    const admin = await login('root', 'pw-root')

    const users = await call('GET', 'users', viewer)
    const reload = await call('POST', 'agents/reload', viewer)
    const system = await call('GET', 'system/properties', viewer)
    const grants = await call('GET', 'users', admin)

    expect(users.status).toBe(403)
    expect(reload.status).toBe(403)
    expect(system.body['lyteboat']).toMatchObject({ agentRoots: [AGENTS] })
    expect(grants.body).toMatchObject({ total: 2, users: [{ userId: 'root', role: 'admin' }, { userId: 'vera', role: 'viewer' }] })
  })

  it('serves the pages at /studio under their CSP, and sends / there', async () => {
    const page = await fetch(`${origin}/studio/users`)
    const root = await fetch(`${origin}/`, { redirect: 'manual' })

    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain('script-src \'self\'')
    expect(await page.text()).toContain('<title>轻舟 Studio</title>')
    expect(root.headers.get('location')).toBe('/studio/')
  })

  it('serves neither /chat nor dsh\'s session channel: Studio never runs a session', async () => {
    expect((await fetch(`${origin}/chat`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${origin}/api/remote.mux`)).status).toBe(404)
  })
})

describe('lyteboat studio without accounts (in process)', () => {
  const scratch = createLyteboatScratch('studio-empty')

  afterAll(() => { scratch.remove() })

  it('refuses to start in internal mode and names the command that makes the first account', async () => {
    const run = scratch.run('empty')

    const result = await bootComposition({ bundles: LYTEBOAT_STUDIO_BUNDLES, args: ['--agents', AGENTS, '--port', '0'], cwd: run.workspace, home: run.home, env: {}, timeoutMs: 60_000 })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('error: this Studio has no accounts to sign in with; make the first one with: lyteboat studio account add <username> --role admin < password-file')
  })
})
