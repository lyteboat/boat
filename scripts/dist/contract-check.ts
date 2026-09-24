/**
 * G1, the contract gate: lyteboat's kernel build keeps every promise the pinned
 * release makes. The contract of the workspace build (see `contract-gen.ts`)
 * is compared key by key with `dsh-compat/contract/dsh-<version>/`:
 *
 * - a key upstream has and lyteboat's build lacks fails, always;
 * - a key whose value changed, or a key only lyteboat's build has, fails unless an
 *   entry of `dsh-compat/contract/extensions.yml` lists it (or a prefix of it);
 * - a listed key that shows no difference fails too, so the registry never
 *   outlives the extension it describes.
 *
 *   node --import tsx scripts/dist/contract-check.ts [<tree root>]
 *
 * The tree root defaults to the workspace, which resolves the kernel packages
 * to `dsh/` through the pnpm overrides; run after `pnpm run build`.
 * @module scripts/dist/contract-check
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { CONTRACT_FILES, generateContract } from './contract-gen.ts'
import type { Contract } from './contract-gen.ts'
import { canonicalJson, readUpstreamPin, repoRoot } from './kernel.ts'

/** Separator of the path segments in a contract key; event names and subpaths contain `/`. */
export const KEY_SEPARATOR = ' › '

/** One entry of `dsh-compat/contract/extensions.yml`. */
export interface ContractExtension {
  id: string
  package: string
  kind: string
  surface: string
  contract: string[]
  since: string
  exit: string
  tests: string[]
}

export function readExtensions(): ContractExtension[] {
  const parsed = parse(readFileSync(join(repoRoot, 'dsh-compat/contract/extensions.yml'), 'utf8')) as { extensions?: ContractExtension[] | null }
  const extensions = parsed.extensions ?? []
  const ids = new Set<string>()
  for (const extension of extensions) {
    for (const field of ['id', 'package', 'kind', 'surface', 'since', 'exit'] as const) {
      if (typeof extension[field] !== 'string' || extension[field] === '') throw new Error(`dsh-compat/contract/extensions.yml: an entry lacks "${field}"`)
    }
    if (!Array.isArray(extension.contract) || !Array.isArray(extension.tests)) throw new Error(`dsh-compat/contract/extensions.yml: ${extension.id} needs "contract" and "tests" lists`)
    if (ids.has(extension.id)) throw new Error(`dsh-compat/contract/extensions.yml: duplicate id ${extension.id}`)
    ids.add(extension.id)
  }
  return extensions
}

/** Flatten nested objects to `key › key › …` → leaf; arrays and primitives are leaves. */
export function flatten(value: unknown, prefix: string[] = [], out = new Map<string, string>()): Map<string, string> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) flatten(inner, [...prefix, key], out)
    return out
  }
  out.set(prefix.join(KEY_SEPARATOR), canonicalJson(value))
  return out
}

export function flattenContract(contract: Contract): Map<string, string> {
  const out = new Map<string, string>()
  for (const file of CONTRACT_FILES) flatten(contract[file], [file], out)
  return out
}

export function readSnapshot(version: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const file of CONTRACT_FILES) {
    flatten(JSON.parse(readFileSync(join(repoRoot, 'dsh-compat/contract', `dsh-${version}`, `${file}.json`), 'utf8')), [file], out)
  }
  return out
}

/** The outcome of comparing a build with a snapshot under a registry. */
export interface ContractComparison {
  removed: string[]
  unregistered: { key: string; upstream: string | undefined; lyteboat: string }[]
  registered: { key: string; extension: string }[]
  stale: { extension: string; entry: string }[]
}

export function compareContract(upstream: Map<string, string>, lyteboat: Map<string, string>, extensions: readonly ContractExtension[]): ContractComparison {
  const owner = (key: string): string | undefined => extensions.find(extension =>
    extension.contract.some(entry => key === entry || key.startsWith(`${entry}${KEY_SEPARATOR}`)))?.id
  const result: ContractComparison = { removed: [], unregistered: [], registered: [], stale: [] }
  const used = new Set<string>()
  for (const key of upstream.keys()) if (!lyteboat.has(key)) result.removed.push(key)
  for (const [key, value] of lyteboat) {
    const before = upstream.get(key)
    if (before === value) continue
    const extension = owner(key)
    if (extension === undefined) {
      result.unregistered.push({ key, upstream: before, lyteboat: value })
      continue
    }
    result.registered.push({ key, extension })
    for (const entry of extensions.find(item => item.id === extension)?.contract ?? []) {
      if (key === entry || key.startsWith(`${entry}${KEY_SEPARATOR}`)) used.add(`${extension}\u0000${entry}`)
    }
  }
  for (const extension of extensions) {
    for (const entry of extension.contract) {
      if (!used.has(`${extension.id}\u0000${entry}`)) result.stale.push({ extension: extension.id, entry })
    }
  }
  return result
}

function clip(text: string | undefined): string {
  if (text === undefined) return '(absent)'
  return text.length > 240 ? `${text.slice(0, 240)}…` : text
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? repoRoot)
  const { dsh } = readUpstreamPin()
  const comparison = compareContract(readSnapshot(dsh), flattenContract(await generateContract(root)), readExtensions())
  for (const key of comparison.removed) console.error(`G1 removed: ${key}`)
  for (const { key, upstream, lyteboat } of comparison.unregistered) {
    console.error(`G1 unregistered ${upstream === undefined ? 'addition' : 'change'}: ${key}\n  upstream: ${clip(upstream)}\n  lyteboat:     ${clip(lyteboat)}`)
  }
  for (const { extension, entry } of comparison.stale) console.error(`G1 stale registration: ${extension} lists ${entry}, which does not differ from upstream`)
  const failures = comparison.removed.length + comparison.unregistered.length + comparison.stale.length
  console.log(`G1 contract vs dsh ${dsh}: ${String(comparison.registered.length)} registered difference(s), ${String(failures)} failure(s)`)
  if (failures > 0) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
