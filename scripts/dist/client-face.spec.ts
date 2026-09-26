import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { carriesClientFace, clientFaceFiles } from './client-face.ts'

const dirs: string[] = []

function packageWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lyteboat-client-face-spec-'))
  dirs.push(dir)
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), '')
  }
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('carriesClientFace is true only for a manifest that declares dsh.client', () => {
  expect(carriesClientFace({ dsh: { client: { platform: 'web' } } })).toBe(true)
  expect(carriesClientFace({ dsh: {} })).toBe(false)
  expect(carriesClientFace({})).toBe(false)
})

test('clientFaceFiles lists the browser bundle and every ./client declaration, and nothing of the Node face', () => {
  const dir = packageWith(['lib/client.js', 'lib/index.js', 'lib/types/index.d.ts', 'lib/types/client/index.d.ts', 'lib/types/client/sessions/manager.js'])

  expect(clientFaceFiles(dir)).toEqual(['lib/client.js', 'lib/types/client/index.d.ts', 'lib/types/client/sessions/manager.js'])
})

test('clientFaceFiles is empty for a package without a browser face', () => {
  expect(clientFaceFiles(packageWith(['lib/index.js']))).toEqual([])
})
