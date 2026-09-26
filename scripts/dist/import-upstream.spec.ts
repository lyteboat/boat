import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { IMPORT_TRAILER, lastImport, normalizedTsconfig } from './import-upstream.ts'

const repositories: string[] = []

function emptyRepository(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lyteboat-import-spec-'))
  repositories.push(dir)
  execFileSync('git', ['init', '--quiet', dir])
  return dir
}

/** Commit an empty change with `message` on HEAD and return its hash. */
function commit(repository: string, message: string): string {
  const identity = { GIT_AUTHOR_NAME: 'spec', GIT_AUTHOR_EMAIL: 'spec@example.invalid', GIT_COMMITTER_NAME: 'spec', GIT_COMMITTER_EMAIL: 'spec@example.invalid' }
  execFileSync('git', ['-C', repository, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', message], { env: { ...process.env, ...identity } })
  return execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

afterEach(() => {
  for (const dir of repositories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('lastImport finds no import when HEAD is unborn', () => {
  expect(lastImport('HEAD', emptyRepository())).toBeUndefined()
})

test('lastImport returns the newest import reachable from HEAD when later commits are not imports', () => {
  const repository = emptyRepository()
  commit(repository, `dist(import): dsh-v0.0.1 kernel\n\n${IMPORT_TRAILER}: dsh-v0.0.1`)
  const newest = commit(repository, `dist(import): dsh-v0.0.2 kernel\n\n${IMPORT_TRAILER}: dsh-v0.0.2`)
  commit(repository, 'chore: work on top of the import')

  expect(lastImport('HEAD', repository)).toBe(newest)
})

function tsconfigFile(references: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lyteboat-tsconfig-spec-'))
  repositories.push(dir)
  const file = join(dir, 'tsconfig.json')
  writeFileSync(file, JSON.stringify({ files: [], references: references.map(path => ({ path })) }))
  return file
}

function keptPaths(text: string): string[] {
  return (JSON.parse(text) as { references: { path: string }[] }).references.map(reference => reference.path)
}

const sessionController = { name: '@deepseek-ai/dsh-api-session-controller', dir: 'api/session-controller' }
const kernelDirs = new Set(['core/session', 'api/session-controller'])

test('normalizedTsconfig keeps kernel references and the package\'s own configs, and drops npm packages', () => {
  const file = tsconfigFile(['./tsconfig.host.json', '../../core/session', '../../workspace/workspace', '../../client/connection/tsconfig.host.json', '../../../vendor/cordis'])

  expect(keptPaths(normalizedTsconfig(file, sessionController, kernelDirs, false))).toEqual(['./tsconfig.host.json', '../../core/session'])
})

test('normalizedTsconfig drops the browser-face config when the browser face is carried', () => {
  const file = tsconfigFile(['./tsconfig.host.json', './tsconfig.client.json'])

  expect(keptPaths(normalizedTsconfig(file, sessionController, kernelDirs, true))).toEqual(['./tsconfig.host.json'])
  expect(keptPaths(normalizedTsconfig(file, sessionController, kernelDirs, false))).toEqual(['./tsconfig.host.json', './tsconfig.client.json'])
})
