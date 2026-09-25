/**
 * Keep the words a deployment marks as sensitive out of the repository. The word list is
 * never committed: `LYTEBOAT_SENSITIVE_WORDS` (comma-separated) or
 * `LYTEBOAT_SENSITIVE_WORDS_FILE` (one word per line) supplies it, and without either the
 * check says it skipped and passes. A word in Latin letters matches a whole token: text is
 * split at every non-letter and at camelCase boundaries, so `foo_bar`, `foo-bar`, `fooBar`,
 * and `FOOBar` each yield `foo` and `bar`, compared case-insensitively. Any other word
 * matches as a substring. Every file git tracks or would track is scanned, path and
 * content, except binary files, `pnpm-lock.yaml` (its integrity hashes are base64), and
 * upstream's kernel tests. Exits non-zero with one line per hit.
 *
 *   LYTEBOAT_SENSITIVE_WORDS=foo,bar node --import tsx scripts/check-sensitive.ts
 * @module scripts/check-sensitive
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Generated files whose content no one writes by hand. */
const SKIPPED = new Set(['pnpm-lock.yaml'])

/**
 * Upstream's kernel tests, imported byte for byte and never edited (CLAUDE.md):
 * their streamed tool-argument fixtures cut words mid-token, so fragments of
 * ordinary words turn up as tokens of their own.
 */
const UPSTREAM_TESTS = /^dsh\/[^/]+\/[^/]+\/tests\/(?!lyteboat\/)/

const LATIN_WORD = /^[a-z]+$/i
const TOKEN = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g

function sensitiveWords(): string[] | undefined {
  const inline = process.env['LYTEBOAT_SENSITIVE_WORDS']
  const file = process.env['LYTEBOAT_SENSITIVE_WORDS_FILE']
  const raw = inline !== undefined && inline !== '' ? inline.split(',') : file !== undefined && file !== '' ? readFileSync(file, 'utf8').split('\n') : undefined
  return raw?.map(word => word.trim()).filter(word => word !== '')
}

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  return out.split('\0').filter(path => path !== '')
}

function tokensOf(text: string): Set<string> {
  const tokens = new Set<string>()
  for (const token of text.match(TOKEN) ?? []) tokens.add(token.toLowerCase())
  return tokens
}

/** The sensitive words `text` contains, in list order. */
function hitsIn(text: string, latin: readonly string[], other: readonly string[]): string[] {
  const tokens = tokensOf(text)
  return [...latin.filter(word => tokens.has(word)), ...other.filter(word => text.includes(word))]
}

const words = sensitiveWords()
if (words === undefined) {
  console.log('check-sensitive: skipped, LYTEBOAT_SENSITIVE_WORDS / LYTEBOAT_SENSITIVE_WORDS_FILE not set')
  process.exit(0)
}
const latin = words.filter(word => LATIN_WORD.test(word)).map(word => word.toLowerCase())
const other = words.filter(word => !LATIN_WORD.test(word))

const hits: string[] = []
let scanned = 0
for (const path of trackedFiles()) {
  for (const word of hitsIn(path, latin, other)) hits.push(`${path}: path contains "${word}"`)
  if (SKIPPED.has(path) || UPSTREAM_TESTS.test(path)) continue
  let content: Buffer
  try {
    content = readFileSync(join(root, path))
  } catch {
    // A deleted file git still tracks until the deletion is staged: nothing to scan.
    continue
  }
  if (content.subarray(0, 8000).includes(0)) continue
  scanned++
  content.toString('utf8').split('\n').forEach((line, index) => {
    for (const word of hitsIn(line, latin, other)) hits.push(`${path}:${index + 1}: "${word}"`)
  })
}

for (const hit of hits) console.error(hit)
console.log(`check-sensitive: ${scanned} files, ${words.length} words, ${hits.length} hits`)
process.exit(hits.length === 0 ? 0 : 1)
