/**
 * The distribution's shared facts: where the repository is, which dsh release
 * it tracks (`dsh.upstream.json`), and which dsh packages it owns
 * (`dsh/kernel.json`). Every `scripts/dist` tool reads them from here.
 * @module scripts/dist/kernel
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** `dsh.upstream.json`: the pinned dsh release and the cordis versions its tag vendors. */
export interface UpstreamPin {
  dsh: string
  tag: string
  commit: string
  repository: string
  cordis: Record<string, string>
}

/** One taken-over package: its published name and its directory under upstream `packages/` and under `dsh/`. */
export interface KernelPackage {
  name: string
  dir: string
}

export function readUpstreamPin(): UpstreamPin {
  return JSON.parse(readFileSync(join(repoRoot, 'dsh.upstream.json'), 'utf8')) as UpstreamPin
}

export function kernelPackages(): KernelPackage[] {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'dsh/kernel.json'), 'utf8')) as { packages: Record<string, string> }
  return Object.entries(manifest.packages).map(([name, dir]) => ({ name, dir }))
}

/** Run git in `cwd` and return trimmed stdout. */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
}

/** Stable JSON: object keys sorted at every depth, so snapshots diff line by line. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

/** One-line stable JSON, for comparing values whose key order carries no meaning. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(entries.map(([key, inner]) => [key, sortKeys(inner)]))
}
