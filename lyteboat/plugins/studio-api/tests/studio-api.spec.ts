/**
 * The Studio API on the unit host, over a real listener: the Host allowlist,
 * the headers every answer carries, sign-in and role checks, the Users
 * endpoints and their audit lines, request bodies, the System page, and the
 * agent radar with release locks. The agent catalog, the web server, and
 * studioAuth are mounted, not stubbed; only the credentials service is a table.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import AgentCatalogService from '@lyteboat/agent-catalog'
import LyteboatDistroService from '@lyteboat/distro'
import * as studioApi from '@lyteboat/studio-api'
import StudioAuthService from '@lyteboat/studio-auth'
import { setStudioAccount, setStudioGrant } from '@lyteboat/studio-auth/accounts'
import { MockAdapter, createLyteboatUnitHost } from '@lyteboat/testing'
import { studioHostAllowed } from '../src/studio-host-allowlist.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'studio-api-'))
  dirs.push(dir)
  return dir
}

interface StudioFixture {
  ctx: Context
  studioDir: string
  agentsDir: string
  call(method: string, path: string, options?: { token?: string; body?: unknown; host?: string; contentType?: string }): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: unknown }>
  login(username: string, password: string): Promise<string>
}

function writeAgent(agentsDir: string, id: string, manifest: string): void {
  mkdirSync(join(agentsDir, id), { recursive: true })
  writeFileSync(join(agentsDir, id, 'agent.cordis.yml'), '[]\n')
  writeFileSync(join(agentsDir, id, 'agent.yml'), manifest)
}

async function studioFixture(config: studioApi.Config = {}): Promise<StudioFixture> {
  const root = scratch()
  const studioDir = join(root, 'studio')
  const agentsDir = join(root, 'agents')
  writeAgent(agentsDir, 'alpha', 'name: Alpha\ndescription: the first agent\nversion: "1.0.0"\n')
  writeAgent(agentsDir, 'beta', 'version: "0.2.0"\n')
  setStudioAccount(studioDir, 'root', { password: 'pw-root', displayName: 'Root' })
  setStudioGrant(studioDir, 'root', 'admin', 'cli')
  setStudioAccount(studioDir, 'vera', { password: 'pw-vera' })
  setStudioGrant(studioDir, 'vera', 'viewer', 'cli')
  const ctx = await createLyteboatUnitHost(new MockAdapter([]))
  // The unit host has no loader tree; the registry only waits on it to settle, and here it has.
  ctx.provide('loader', { await: () => Promise.resolve() } as never)
  ctx.provide('credentials', { resolve: () => Promise.resolve(undefined) } as never)
  await ctx.plugin(LyteboatDistroService)
  await ctx.plugin(AgentPresetRegistry, { default: 'none' })
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'deepseek-official', model: 'deepseek-flash' })
  await ctx.plugin(AgentCatalogService, { roots: [agentsDir], strict: false, workdirsDir: join(root, 'workdirs') })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(StudioAuthService, { dir: studioDir })
  await ctx.plugin(studioApi, { dir: studioDir, agentRoots: [agentsDir], ...config })
  await ctx.agentCatalog.whenReady()
  const call: StudioFixture['call'] = (method, path, options = {}) => new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
    const request = httpRequest({
      host: '127.0.0.1',
      port: ctx.webServer.port,
      method,
      path: `/api/studio/${path}`,
      headers: {
        host: options.host ?? `127.0.0.1:${String(ctx.webServer.port)}`,
        ...options.token === undefined ? {} : { authorization: `Bearer ${options.token}` },
        ...payload === undefined ? {} : { 'content-type': options.contentType ?? 'application/json' },
      },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => { resolve({ status: response.statusCode ?? 0, headers: response.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }) })
    })
    request.on('error', reject)
    request.end(payload)
  })
  const login = async (username: string, password: string): Promise<string> => {
    const answer = await call('POST', 'auth/login', { body: { username, password } })
    return (answer.body as { token: string }).token
  }
  return { ctx, studioDir, agentsDir, call, login }
}

function auditLines(studioDir: string): Record<string, unknown>[] {
  return readFileSync(join(studioDir, 'audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
}

describe('studioHostAllowed', () => {
  it('accepts the loopback names on any port and a trusted name as configured', () => {
    expect(studioHostAllowed('127.0.0.1:8090', [])).toBe(true)
    expect(studioHostAllowed('LOCALHOST:1', [])).toBe(true)
    expect(studioHostAllowed('[::1]:8090', [])).toBe(true)
    expect(studioHostAllowed('studio.example:443', ['studio.example'])).toBe(true)
    expect(studioHostAllowed('studio.example:443', ['studio.example:8443'])).toBe(false)
    expect(studioHostAllowed('studio.example:8443', ['studio.example:8443'])).toBe(true)
    expect(studioHostAllowed('evil.example', ['studio.example'])).toBe(false)
    expect(studioHostAllowed(undefined, [])).toBe(false)
  })
})

describe('the Studio API', () => {
  it('answers 421 for a Host it was not told about, and carries its security headers on every answer', async () => {
    const studio = await studioFixture({ trustedHosts: ['studio.example'] })

    const rebound = await studio.call('GET', 'auth/config', { host: 'evil.example' })
    const trusted = await studio.call('GET', 'auth/config', { host: 'studio.example' })

    expect(rebound).toMatchObject({ status: 421, body: { error: { code: 'misdirected' } } })
    expect(trusted).toMatchObject({ status: 200, body: { mode: 'internal', loginRequired: true, anonymousViewer: false } })
    for (const answer of [rebound, trusted]) {
      expect(answer.headers).toMatchObject({
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'default-src \'none\'; frame-ancestors \'none\'',
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      })
    }
  })

  it('signs in, answers the session, and refuses a request without a token or a role too low', async () => {
    const studio = await studioFixture()
    const viewer = await studio.login('vera', 'pw-vera')

    const session = await studio.call('GET', 'auth/session', { token: viewer })
    const anonymous = await studio.call('GET', 'agents')
    const users = await studio.call('GET', 'users', { token: viewer })

    expect(session).toMatchObject({ status: 200, body: { userId: 'vera', displayName: 'vera', role: 'viewer' } })
    expect(anonymous).toMatchObject({ status: 401, body: { error: { code: 'unauthorized' } } })
    expect(users).toMatchObject({ status: 403, body: { error: { code: 'forbidden', message: 'this needs the admin role; vera is viewer' } } })
  })

  it('audits a failed login under the username it gave', async () => {
    const studio = await studioFixture()

    const answer = await studio.call('POST', 'auth/login', { body: { username: 'root', password: 'guess' } })

    expect(answer).toMatchObject({ status: 401, body: { error: { code: 'unauthorized', message: 'wrong username or password' } } })
    expect(auditLines(studio.studioDir)).toEqual([{ time: expect.any(Number), actor: 'root', action: 'login.failed', from: '127.0.0.1' }])
  })

  it('lets an admin list, grant, and revoke roles, keeps the two grant rules, and audits each change', async () => {
    const studio = await studioFixture()
    const admin = await studio.login('root', 'pw-root')

    const granted = await studio.call('POST', 'users', { token: admin, body: { userId: 'ed', role: 'editor' } })
    const page = await studio.call('GET', 'users?role=editor&limit=10', { token: admin })
    const self = await studio.call('DELETE', 'users/root', { token: admin })
    const revoked = await studio.call('DELETE', 'users/ed', { token: admin })
    const missing = await studio.call('DELETE', 'users/nobody', { token: admin })

    expect(granted).toMatchObject({ status: 200, body: { userId: 'ed', role: 'editor', createdBy: 'root' } })
    expect(page.body).toMatchObject({ total: 1, users: [{ userId: 'ed' }] })
    expect(self).toMatchObject({ status: 409, body: { error: { code: 'conflict', message: 'you cannot change or revoke your own role' } } })
    expect(revoked).toMatchObject({ status: 200, body: { userId: 'ed', role: 'editor' } })
    expect(missing).toMatchObject({ status: 404 })
    expect(auditLines(studio.studioDir).map(({ actor, action, userId, role }) => ({ actor, action, userId, role }))).toEqual([
      { actor: 'root', action: 'grant.set', userId: 'ed', role: 'editor' },
      { actor: 'root', action: 'grant.remove', userId: 'ed', role: 'editor' },
    ])
  })

  it('refuses a body that is not JSON, too large, or carries an unknown key, and a query out of range', async () => {
    const studio = await studioFixture({ maxBodyBytes: 64 })
    const admin = await studio.login('root', 'pw-root')

    const form = await studio.call('POST', 'users', { token: admin, body: 'userId=x', contentType: 'application/x-www-form-urlencoded' })
    const large = await studio.call('POST', 'users', { token: admin, body: { userId: 'x'.repeat(100), role: 'viewer' } })
    const extra = await studio.call('POST', 'users', { token: admin, body: { userId: 'x', role: 'viewer', note: 1 } })
    const limit = await studio.call('GET', 'users?limit=500', { token: admin })

    expect(form).toMatchObject({ status: 400, body: { error: { message: 'send the body as application/json' } } })
    expect(large).toMatchObject({ status: 413, body: { error: { code: 'payload_too_large' } } })
    expect(extra).toMatchObject({ status: 400, body: { error: { code: 'invalid_request' } } })
    expect(limit).toMatchObject({ status: 400, body: { error: { message: 'limit must be a whole number up to 200' } } })
  })

  it('answers 404 for no endpoint and 405 for a known one called with the wrong method', async () => {
    const studio = await studioFixture()

    expect(await studio.call('GET', 'nowhere')).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } })
    expect(await studio.call('GET', 'auth/login')).toMatchObject({ status: 405, body: { error: { message: 'use POST' } } })
  })

  it('shows the system with secrets masked, the configured ones whatever their names', async () => {
    process.env['STUDIO_SPEC_API_KEY'] = 'plain-looking'
    process.env['STUDIO_SPEC_GATEWAY'] = 'also-plain'
    try {
      const studio = await studioFixture({ maskedEnv: ['STUDIO_SPEC_GATEWAY'], lyteboatVersion: '9.9.9', traceLinkTemplate: 'https://trace.example/t/{trace_id}' })
      const viewer = await studio.login('vera', 'pw-vera')

      const system = await studio.call('GET', 'system/properties', { token: viewer })
      const traceLink = await studio.call('GET', 'config/trace-link', { token: viewer })

      const body = system.body as { lyteboat: Record<string, unknown>; env: { name: string; value: string }[] }
      expect(body.lyteboat).toMatchObject({ version: '9.9.9', dshBase: studio.ctx.lyteboatDistro.dsh, agentRoots: [studio.agentsDir] })
      expect(body.env).toContainEqual({ name: 'STUDIO_SPEC_API_KEY', value: '***' })
      expect(body.env).toContainEqual({ name: 'STUDIO_SPEC_GATEWAY', value: '***' })
      expect(traceLink.body).toEqual({ template: 'https://trace.example/t/{trace_id}' })
    } finally {
      delete process.env['STUDIO_SPEC_API_KEY']
      delete process.env['STUDIO_SPEC_GATEWAY']
    }
  })

  it('lists the agents with their release locks, and shows an agent that changed since its release as deviating', async () => {
    const studio = await studioFixture()
    const admin = await studio.login('root', 'pw-root')
    const alpha = studio.ctx.agentCatalog.get('alpha')
    const lock = { agent: { id: 'alpha', version: '1.0.0', digest: alpha?.identity.digest }, model: { provider: 'p', model: 'm' }, dshBase: 'x', files: {}, baseline: { startedAt: 't', cases: 0, turns: 0, checks: 0, results: `sha256:${'0'.repeat(64)}` } }
    writeFileSync(join(studio.agentsDir, 'alpha', 'agent.release.json'), JSON.stringify(lock))
    writeFileSync(join(studio.agentsDir, 'beta', 'agent.release.json'), '{')

    const released = await studio.call('GET', 'agents', { token: admin })
    writeFileSync(join(studio.agentsDir, 'alpha', 'agent.yml'), 'name: Alpha\ndescription: hot-fixed\nversion: "1.0.0"\n')
    const reloaded = await studio.call('POST', 'agents/reload', { token: admin })

    expect(released.body).toMatchObject({
      agents: [
        { id: 'alpha', name: 'Alpha', version: '1.0.0', release: { version: '1.0.0', digest: alpha?.identity.digest }, deviates: false },
        { id: 'beta', version: '0.2.0', deviates: false, releaseProblem: expect.stringContaining('agent.release.json is not JSON') },
      ],
      failures: [],
    })
    expect(reloaded.body).toMatchObject({ agents: [{ id: 'alpha', description: 'hot-fixed', deviates: true }, { id: 'beta' }] })
    expect(auditLines(studio.studioDir)).toEqual([{ time: expect.any(Number), actor: 'root', action: 'agents.reload', agents: 2, failures: 0 }])
  })

  it('refuses a trace link template without the trace id', async () => {
    await expect(studioFixture({ traceLinkTemplate: 'https://trace.example/' })).rejects.toThrow('traceLinkTemplate must hold {trace_id}')
  })
})
