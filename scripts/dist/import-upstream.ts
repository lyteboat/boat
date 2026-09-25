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
 * lyteboat's branch), so lyteboat's commits under `dsh/` survive every sync and
 * conflict only where upstream changed the same lines.
 *
 * Each file is imported byte for byte from the tag, with two normalizations
 * that make the packages build inside lyteboat's workspace:
 *
 * - `package.json` is the manifest npm publishes for that version (pnpm
 *   publish's resolution of `workspace:` ranges), read from a vanilla tree;
 * - every `tsconfig*.json` at the package root keeps only the `references`
 *   that point at other kernel packages (the rest are dsh packages lyteboat
 *   installs from npm) or at the package's own sibling configs, except the one
 *   that compiles a browser face lyteboat carries (scripts/dist/client-face.ts).
 *
 * A package that exports a Typert Host face (`./typert`) or Remote client
 * (`./remote`) also gets those published files (`lib/typert.*`): upstream's
 * generator emits them from a whole-workspace analysis that cannot run inside
 * lyteboat, so the build uses the published ones while the package's source equals
 * the import (scripts/dist/bundle-kernel.ts) and `dist:overlay … typert`
 * regenerates them from lyteboat's source in an upstream checkout. A package
 * with a browser face (`dsh.client`) likewise gets its published browser
 * bundle and `./client` declarations, which lyteboat neither builds nor changes.
 *
 *   node --import tsx scripts/dist/import-upstream.ts <dsh checkout at a tag> [--trailer "Key: value"]…
 * @module scripts/dist/import-upstream
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { git, kernelPackages, repoRoot } from './kernel.ts'
import type { KernelPackage } from './kernel.ts'
import { releaseOfCheckout, vanillaTree } from './trees.ts'
import { CLIENT_TSCONFIG, carriesClientFace, clientFaceFiles, type ClientFaceManifest } from './client-face.ts'
import { publishedTypertFiles, type TypertManifest } from './typert.ts'

/** Trailer naming the tag an import commit holds; the next import finds its parent by it. */
export const IMPORT_TRAILER = 'Dist-Import'

/** Whether `rev` names a commit in `repo`; an unborn HEAD (a repository before its first commit) does not. */
function commitExists(repo: string, rev: string): boolean {
  return spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).status === 0
}

/**
 * The most recent import commit reachable from `rev`, if any.
 * @param rev - the revision to search from; one that names no commit, as an unborn HEAD, reaches none.
 * @param repo - the repository.
 */
export function lastImport(rev = 'HEAD', repo = repoRoot): string | undefined {
  // `git log` exits 128 on a revision that names no commit.
  if (!commitExists(repo, rev)) return undefined
  const found = git(repo, ['log', '--format=%H', `--grep=^${IMPORT_TRAILER}: `, '-1', rev])
  return found === '' ? undefined : found
}

/** What the operator runs after a new import commit. */
function nextStep(commit: string, parent: string | undefined): string {
  if (parent !== undefined) return `git diff --stat ${parent} ${commit}   # what upstream changed in the kernel\ngit merge --no-ff ${commit}`
  // git refuses a --no-ff merge into a branch without commits ("Non-fast-forward commit does not make sense into an empty head").
  if (!commitExists(repoRoot, 'HEAD')) {
    return `first import, into a branch without commits: start the branch from it\ngit switch -c ${git(repoRoot, ['symbolic-ref', '--short', 'HEAD'])} ${commit}`
  }
  return `first import: git merge --no-ff --allow-unrelated-histories ${commit}`
}

/**
 * Whether a tsconfig reference survives the import: one to a kernel package
 * (its directory or one of its tsconfig files), or to a sibling tsconfig of the
 * same package, except the one that compiles a browser face lyteboat carries.
 */
function keptReference(referencePath: string, pkg: KernelPackage, kernelDirs: ReadonlySet<string>, carriedClient: boolean): boolean {
  // Upstream paths are relative to packages/<dir>; the same relative path holds under dsh/<dir>.
  const target = relative('/packages', resolve('/packages', pkg.dir, referencePath))
  if (!target.endsWith('.json')) return kernelDirs.has(target)
  if (dirname(target) !== pkg.dir) return kernelDirs.has(dirname(target))
  return !(carriedClient && basename(target) === CLIENT_TSCONFIG)
}

/**
 * A package tsconfig as the import writes it: `references` limited to kernel
 * packages and the package's own sibling configs (see {@link keptReference}).
 * @param path - the upstream file.
 * @param pkg - the kernel package it belongs to.
 * @param kernelDirs - every kernel package directory.
 * @param carriedClient - whether the package's browser face is carried as published.
 * @returns the file's new text.
 */
export function normalizedTsconfig(path: string, pkg: KernelPackage, kernelDirs: ReadonlySet<string>, carriedClient: boolean): string {
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'))
  if (parsed.error !== undefined) throw new Error(`${path}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n')}`)
  const config = parsed.config as { references?: { path: string }[] }
  if (config.references !== undefined) {
    config.references = config.references.filter(reference => keptReference(reference.path, pkg, kernelDirs, carriedClient))
  }
  return `${JSON.stringify(config, null, 2)}\n`
}

function copyPublished(publishedDir: string, files: readonly string[], staging: string, pkg: KernelPackage): void {
  for (const file of files) {
    const destination = join(staging, 'dsh', pkg.dir, file)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(publishedDir, file), destination)
  }
}

function stage(checkout: string, staging: string, publishedRoot: string): void {
  const packages = kernelPackages()
  const kernelDirs = new Set(packages.map(pkg => pkg.dir))
  const require = createRequire(join(publishedRoot, 'package.json'))
  for (const pkg of packages) {
    const publishedDir = dirname(realpathSync(require.resolve(`${pkg.name}/package.json`)))
    const manifest = JSON.parse(readFileSync(join(publishedDir, 'package.json'), 'utf8')) as TypertManifest & ClientFaceManifest
    const carriedClient = carriesClientFace(manifest)
    copyPublished(publishedDir, publishedTypertFiles(manifest), staging, pkg)
    if (carriedClient) copyPublished(publishedDir, clientFaceFiles(publishedDir), staging, pkg)
    const source = `packages/${pkg.dir}`
    const files = git(checkout, ['ls-files', '-z', '--', source]).split('\0').filter(file => file !== '')
    if (files.length === 0) throw new Error(`${pkg.name}: ${source} does not exist at this tag`)
    for (const file of files) {
      const destination = join(staging, 'dsh', pkg.dir, relative(source, file))
      mkdirSync(dirname(destination), { recursive: true })
      if (file === `${source}/package.json`) {
        const published = realpathSync(require.resolve(`${pkg.name}/package.json`))
        writeFileSync(destination, readFileSync(published))
      } else if (dirname(file) === source && /^tsconfig[^/]*\.json$/u.test(basename(file))) {
        writeFileSync(destination, normalizedTsconfig(join(checkout, file), pkg, kernelDirs, carriedClient))
      } else {
        copyFileSync(join(checkout, file), destination)
      }
    }
  }
}

function commitTree(staging: string, message: string, parent: string | undefined): { commit: string; tree: string } {
  const index = join(mkdtempSync(join(tmpdir(), 'lyteboat-import-index-')), 'index')
  const env = { ...process.env, GIT_INDEX_FILE: index }
  const gitDir = git(repoRoot, ['rev-parse', '--absolute-git-dir'])
  const run = (args: string[]): string => execFileSync('git', [`--git-dir=${gitDir}`, `--work-tree=${staging}`, ...args], { cwd: staging, env, encoding: 'utf8' }).trim()
  // --force: the import is the tag's file set, whatever lyteboat's .gitignore says about it.
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
  const staging = mkdtempSync(join(tmpdir(), 'lyteboat-import-'))
  try {
    stage(checkout, staging, publishedRoot)
    const parent = lastImport()
    const message = [
      `dist(import): ${tag} kernel`,
      '',
      `The ${String(kernelPackages().length)} kernel packages of deepseek-ai/deepseek-harness at ${tag}, as`,
      'scripts/dist/import-upstream.ts writes them: every file byte for byte, except',
      'package.json (the manifest npm publishes for this version) and the tsconfig',
      'files (references limited to kernel packages and the package\'s own Node-face',
      'configs); a package with a Typert Host face or Remote client also carries its',
      'published lib/typert.* files, and one with a browser face its published',
      'lib/client.js and lib/types/client/.',
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
    console.log(nextStep(commit, parent))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
