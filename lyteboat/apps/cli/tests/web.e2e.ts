/**
 * `lyteboat web` on the built launcher: it boots the web profile (dsh
 * web with lyteboat's pages), serves the page behind the token exchange with
 * the web pages' browser bundle in its roster, answers the pages'
 * endpoints for the agents of `--agents`, stops cleanly on SIGTERM, and
 * refuses an agent directory that does not exist or an `--agent` none holds.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { createLyteboatScratch } from '@lyteboat/testing/scratch'
import { runLyteboat, startLyteboat } from './support/lyteboat-process.ts'

const AGENTS = fileURLToPath(new URL('./fixtures/agents', import.meta.url))

describe('lyteboat web (built bin)', () => {
  const scratch = createLyteboatScratch('web-smoke')

  afterAll(() => { scratch.remove() })

  it('serves dsh web with the web pages behind the token exchange, and stops cleanly on SIGTERM', async () => {
    const { home, workspace } = scratch.run('web')
    const lyteboat = startLyteboat(['web', '--agents', AGENTS, '--no-open', '--port', '0'], {
      cwd: workspace,
      env: { LYTEBOAT_HOME: home, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    })
    try {
      const launchUrl = (await lyteboat.waitForStdout(/dsh web: (http:\/\/\S+)/u, 90_000))[1] ?? ''
      await lyteboat.waitForStdout(/^lyteboat web: agents echo$/mu, 30_000)
      // The token URL sets the session cookie and redirects to the page.
      const exchange = await fetch(launchUrl, { redirect: 'manual' })
      expect(exchange.status).toBe(303)
      const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
      // Without the cookie the page is refused; with it the page lists the web pages' bundle.
      const anonymous = await fetch(new URL('/', launchUrl))
      expect(anonymous.status).toBe(401)
      const page = await fetch(new URL('/', launchUrl), { headers: { cookie } })
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('@lyteboat/web-pages/client.js')

      const agents = await fetch(new URL('/api/lyteboat/agents', launchUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: 'lyteboat/agents', payload: {} }),
      })
      expect(await agents.json()).toMatchObject({ type: 'server-response', result: { ok: true, value: { agents: [{ id: 'echo' }], failures: [] } } })
    } finally {
      const code = await lyteboat.stop('SIGTERM')
      expect(code, lyteboat.output()).toBe(0)
    }
  })

  it('refuses an agent directory that does not exist, and a default agent no directory holds', async () => {
    const { home, workspace } = scratch.run('usage')
    const missing = join(workspace, 'no-agents')
    const env = { LYTEBOAT_HOME: home, DSH_TELEMETRY_DISABLED: '1' }

    const noDirectory = await runLyteboat(['web', '--agents', missing, '--no-open'], { cwd: workspace, env })
    const noAgent = await runLyteboat(['web', '--agents', AGENTS, '--agent', 'ghost', '--no-open'], { cwd: workspace, env })

    expect(noDirectory.code).not.toBe(0)
    expect(noDirectory.stderr).toContain(`error: --agents directory not found: ${missing}`)
    expect(noAgent.code).not.toBe(0)
    expect(noAgent.stderr).toContain('error: no --agents directory holds agent "ghost" (available: echo)')
  })
})
