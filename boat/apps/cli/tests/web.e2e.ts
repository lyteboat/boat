import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBoat } from './support/boat-process.ts'

describe('boat web (built bin)', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'boat-web-home-'))
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('serves the browser UI behind the token exchange and stops cleanly on SIGTERM', async () => {
    const boat = startBoat(['web', '--no-open', '--port', '0'], {
      env: { BOAT_HOME: home, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    })
    try {
      const match = await boat.waitForStdout(/dsh web: (http:\/\/\S+)/u, 90_000)
      const launchUrl = match[1]!
      // The token URL sets the session cookie and redirects to the page.
      const exchange = await fetch(launchUrl, { redirect: 'manual' })
      expect(exchange.status).toBe(303)
      const setCookie = exchange.headers.get('set-cookie')
      expect(setCookie).not.toBeNull()
      const cookie = setCookie!.split(';', 1)[0]!
      // Without the cookie the page is refused; with it the frontend shell is served.
      const anonymous = await fetch(new URL('/', launchUrl))
      expect(anonymous.status).toBe(401)
      const page = await fetch(new URL('/', launchUrl), { headers: { cookie } })
      expect(page.status).toBe(200)
      expect(page.headers.get('content-type')).toContain('text/html')
      expect(await page.text()).toContain('<html')
    } finally {
      const code = await boat.stop('SIGTERM')
      expect(code, boat.output()).toBe(0)
    }
  })
})
