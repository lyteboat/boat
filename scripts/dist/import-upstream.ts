/**
 * Import the kernel packages of a dsh tag as one commit on the upstream line,
 * then leave the merge to the operator (`git merge <commit>`).
 *
 * The upstream line is a chain of import commits: each one's tree holds only
 * `dsh/<dir>/` for every kernel package at one tag, and its parent is the
 * previous import (the first one is a root commit). No branch has to carry it:
 * every import is reachable from the branch through the merge that took it in,
 * and the next import finds its parent by the `Dist-Import` trailer. Merging a
 * new import is then an ordinary three-way merge (previous tag, new tag,
 * boat's branch), so boat's commits under `dsh/` survive every sync and
 * conflict only where upstream changed the same lines.
 *
 * Each file is imported byte for byte from the tag, with two normalizations
 * that make the packages build inside boat's workspace:
 *
 * - `package.json` is the manifest npm publishes for that version (pnpm
 *   publish's resolution of `workspace:` ranges), read from a vanilla tree;
 * - `tsconfig.json` keeps only the `references` that point at other kernel
 *   packages (the rest are dsh packages boat installs from npm).
 *
 *   node --import tsx scripts/dist/import-upstream.ts <dsh checkout at a tag> [--trailer "Key: value"]…
 * @module scripts/dist/import-upstream
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { git, kernelPackages, repoRoot } from './kernel.ts'
import type { KernelPackage } from './kernel.ts'
import { releaseOfCheckout, vanillaTree } from './trees.ts'

/** Trailer naming the tag an import commit holds; the next import finds its parent by it. */
export const IMPORT_TRAILER = 'Dist-Import'

/** The most recent import commit reachable from `rev`, if any. */
export function lastImport(rev = 'HEAD'): string | undefined {
  const found = git(repoRoot, ['log', '--format=%H', `--grep=^${IMPORT_TRAILER}: `, '-1', rev])
  return found === '' ? undefined : found
}

function normalizedTsconfig(path: string, pkg: KernelPackage, kernelDirs: ReadonlySet<string>): string {
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'))
  if (parsed.error !== undefined) throw new Error(`${path}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n')}`)
  const config = parsed.config as { references?: { path: string }[] }
  if (config.references !== undefined) {
    // Upstream paths are relative to packages/<dir>; the same relative path holds under dsh/<dir>.
    config.references = config.references.filter(reference => kernelDirs.has(relative('/packages', resolve('/packages', pkg.dir, reference.path))))
  }
  return `${JSON.stringify(config, null, 2)}\n`
}

function stage(checkout: string, staging: string, publishedRoot: string): void {
  const packages = kernelPackages()
  const kernelDirs = new Set(packages.map(pkg => pkg.dir))
  const require = createRequire(join(publishedRoot, 'package.json'))
  for (const pkg of packages) {
    const source = `packages/${pkg.dir}`
    const files = git(checkout, ['ls-files', '-z', '--', source]).split('\0').filter(file => file !== '')
    if (files.length === 0) throw new Error(`${pkg.name}: ${source} does not exist at this tag`)
    for (const file of files) {
      const destination = join(staging, 'dsh', pkg.dir, relative(source, file))
      mkdirSync(dirname(destination), { recursive: true })
      if (file === `${source}/package.json`) {
        const published = realpathSync(require.resolve(`${pkg.name}/package.json`))
        writeFileSync(destination, readFileSync(published))
      } else if (file === `${source}/tsconfig.json`) {
        writeFileSync(destination, normalizedTsconfig(join(checkout, file), pkg, kernelDirs))
      } else {
        copyFileSync(join(checkout, file), destination)
      }
    }
  }
}

function commitTree(staging: string, message: string, parent: string | undefined): { commit: string; tree: string } {
  const index = join(mkdtempSync(join(tmpdir(), 'boat-import-index-')), 'index')
  const env = { ...process.env, GIT_INDEX_FILE: index }
  const gitDir = git(repoRoot, ['rev-parse', '--absolute-git-dir'])
  const run = (args: string[]): string => execFileSync('git', [`--git-dir=${gitDir}`, `--work-tree=${staging}`, ...args], { cwd: staging, env, encoding: 'utf8' }).trim()
  // --force: the import is the tag's file set, whatever boat's .gitignore says about it.
  run(['add', '--all', '--force', '.'])
  const tree = run(['write-tree'])
  rmSync(dirname(index), { recursive: true, force: true })
  const args = ['commit-tree', tree, '-F', '-']
  if (parent !== undefined) args.push('-p', parent)
  const commit = execFileSync('git', ['-C', repoRoot, ...args], { input: message, encoding: 'utf8' }).trim()
  return { commit, tree }
}

function main(): void {
  const args = process.argv.slice(2)
  const checkout = args[0]
  if (checkout === undefined) throw new Error('usage: import-upstream.ts <dsh checkout at a tag> [--trailer "Key: value"]…')
  const trailers: string[] = []
  for (let i = 1; i < args.length; i += 2) {
    const value = args[i + 1]
    if (args[i] !== '--trailer' || value === undefined) throw new Error(`unexpected argument ${String(args[i])}`)
    trailers.push(value)
  }
  const tag = git(checkout, ['describe', '--tags', '--exact-match', 'HEAD'])
  const upstreamCommit = git(checkout, ['rev-parse', 'HEAD'])
  const release = releaseOfCheckout(checkout)
  const publishedRoot = vanillaTree('import', {}, release)
  const staging = mkdtempSync(join(tmpdir(), 'boat-import-'))
  try {
    stage(checkout, staging, publishedRoot)
    const parent = lastImport()
    const message = [
      `dist(import): ${tag} kernel`,
      '',
      `The ${String(kernelPackages().length)} kernel packages of deepseek-ai/deepseek-harness at ${tag}, as`,
      'scripts/dist/import-upstream.ts writes them: every file byte for byte, except',
      'package.json (the manifest npm publishes for this version) and tsconfig.json',
      '(references limited to kernel packages).',
      '',
      `${IMPORT_TRAILER}: ${tag}`,
      `Dist-Upstream-Commit: ${upstreamCommit}`,
      ...trailers,
      '',
    ].join('\n')
    const { commit, tree } = commitTree(staging, message, parent)
    if (parent !== undefined && git(repoRoot, ['rev-parse', `${parent}^{tree}`]) === tree) {
      console.log(`${tag}: the kernel is identical to the last import ${parent.slice(0, 10)}; nothing to merge`)
      return
    }
    console.log(`imported ${tag} (${upstreamCommit.slice(0, 10)}) as ${commit}`)
    console.log(parent === undefined
      ? `first import: git merge --no-ff --allow-unrelated-histories ${commit}`
      : `git diff --stat ${parent} ${commit}   # what upstream changed in the kernel\ngit merge --no-ff ${commit}`)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
