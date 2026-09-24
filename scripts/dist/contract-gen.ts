/**
 * Generate the contract snapshot of the kernel packages as some tree resolves
 * them: what a plugin written against dsh can observe without reading source.
 *
 * - `api.json`: per package and export subpath, every exported name with its
 *   declaration as the package's `.d.ts` states it (comments and private class
 *   members dropped, whitespace collapsed, relative `import("…")` types
 *   rewritten to package paths), plus the package's module augmentations other
 *   than cordis `Context` and `Events`.
 * - `services.json`: the `ctx` keys the package declares on cordis `Context`.
 * - `events.json`: the cordis events the package declares, with their `@mode`.
 * - `config.json`: at runtime, each entry's plugin `name`, `inject`, and
 *   schemastery `Config` (as canonical JSON), for the module and for every
 *   exported class that carries them.
 *
 * `persistence-schema.json` is upstream's own artifact and is copied beside
 * these by the sync, not generated here.
 *
 *   node --import tsx scripts/dist/contract-gen.ts <tree root> <out dir>
 *
 * A tree root is any directory from which the kernel packages resolve by name:
 * the workspace root (lyteboat's build) or a tree from `trees.ts` (the release).
 * @module scripts/dist/contract-gen
 */

import { mkdirSync, realpathSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { kernelPackages, repoRoot, stableJson } from './kernel.ts'

/** The snapshot files this module generates, by file stem. */
export interface Contract {
  api: Record<string, PackageApi>
  services: Record<string, Record<string, string>>
  events: Record<string, Record<string, EventContract>>
  config: Record<string, Record<string, Record<string, PluginRuntimeContract>>>
}

export interface PackageApi {
  exports: Record<string, Record<string, string | Record<string, string>>>
  augmentations: Record<string, Record<string, string>>
}

export interface EventContract {
  mode: string | null
  signature: string
}

export interface PluginRuntimeContract {
  name?: unknown
  inject?: unknown
  Config?: unknown
}

export const CONTRACT_FILES = ['api', 'services', 'events', 'config'] as const

interface ResolvedPackage {
  name: string
  dir: string
  exports: Record<string, { types?: string; default?: string }>
}

function resolvePackages(root: string): ResolvedPackage[] {
  const require = createRequire(join(root, 'package.json'))
  return kernelPackages().map(({ name }) => {
    const manifestPath = realpathSync(require.resolve(`${name}/package.json`))
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exports: Record<string, unknown> }
    const exports: ResolvedPackage['exports'] = {}
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (typeof target !== 'object' || target === null) continue
      exports[subpath] = target as { types?: string; default?: string }
    }
    return { name, dir: dirname(manifestPath), exports }
  })
}

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })

/** Where `file` sits as `<package name>/<path>`, for rewriting relative `import("…")` types. */
function packagePathOf(file: string): string {
  let dir = dirname(file)
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) return file
    dir = parent
  }
  const { name } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string }
  return `${name}/${relative(dir, file).split(sep).join('/')}`
}

function normalize(text: string, file: string): string {
  return text
    .replace(/import\("(\.[^"]+)"\)/gu, (_match, specifier: string) => `import("${packagePathOf(resolve(dirname(file), specifier)).replace(/\.d\.ts$|\.js$/u, '')}")`)
    .replace(/\s+/gu, ' ')
    .replace(/^(export )?(declare )?/u, '')
    .trim()
}

function isPrivateMember(member: ts.ClassElement): boolean {
  if (member.name !== undefined && ts.isPrivateIdentifier(member.name)) return true
  return (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private) !== 0
}

function printDeclaration(decl: ts.Declaration): string {
  const file = decl.getSourceFile()
  let node: ts.Node = decl
  if (ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent)) node = decl.parent.parent
  return normalize(printer.printNode(ts.EmitHint.Unspecified, node, file), file.fileName)
}

function memberKey(member: ts.ClassElement | ts.TypeElement): string {
  if (ts.isConstructorDeclaration(member)) return 'constructor'
  if (ts.isCallSignatureDeclaration(member)) return '()'
  if (ts.isConstructSignatureDeclaration(member)) return 'new()'
  if (ts.isIndexSignatureDeclaration(member)) return '[index]'
  const { name } = member
  if (name === undefined) return '?'
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return name.getText()
}

/**
 * A class or interface as `{ $declaration, <member>: text }`, so a changed
 * member is reported by name; anything else as its declaration text.
 */
function describeExport(checker: ts.TypeChecker, symbol: ts.Symbol): string | Record<string, string> {
  const target = (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol
  const declarations = target.declarations ?? []
  if (declarations.length === 0) return '<no declaration>'
  if (!declarations.every(decl => ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl))) {
    return declarations.map(printDeclaration).sort().join('\n')
  }
  // A Map, not an object literal: members are named `constructor`, `toString`, ….
  const members = new Map<string, string[]>([['$declaration', []]])
  for (const decl of declarations as (ts.ClassDeclaration | ts.InterfaceDeclaration)[]) {
    const file = decl.getSourceFile()
    const shell = ts.isClassDeclaration(decl)
      ? ts.factory.updateClassDeclaration(decl, decl.modifiers, decl.name, decl.typeParameters, decl.heritageClauses, [])
      : ts.factory.updateInterfaceDeclaration(decl, decl.modifiers, decl.name, decl.typeParameters, decl.heritageClauses, [])
    members.get('$declaration')?.push(normalize(printer.printNode(ts.EmitHint.Unspecified, shell, file), file.fileName))
    const own: readonly (ts.ClassElement | ts.TypeElement)[] = ts.isClassDeclaration(decl) ? decl.members.filter(member => !isPrivateMember(member)) : decl.members
    for (const member of own) {
      const key = memberKey(member)
      const texts = members.get(key) ?? []
      texts.push(normalize(printer.printNode(ts.EmitHint.Unspecified, member, file), file.fileName))
      members.set(key, texts)
    }
  }
  return Object.fromEntries([...members].map(([key, texts]) => [key, texts.sort().join('\n')]))
}

function modeOf(member: ts.TypeElement): string | null {
  const tag = ts.getJSDocTags(member).find(item => item.tagName.text === 'mode')
  return tag === undefined ? null : (ts.getTextOfJSDocComment(tag.comment) ?? '').trim()
}

function joinOverload(previous: string | undefined, text: string): string {
  return previous === undefined ? text : [previous, text].sort().join('\n')
}

function collectAugmentations(file: ts.SourceFile, pkg: string, contract: Contract): void {
  for (const statement of file.statements) {
    if (!ts.isModuleDeclaration(statement) || statement.body === undefined || !ts.isModuleBlock(statement.body)) continue
    const moduleName = ts.isStringLiteral(statement.name) ? statement.name.text : statement.name.text
    for (const inner of statement.body.statements) {
      if (!ts.isInterfaceDeclaration(inner)) continue
      for (const member of inner.members) {
        const name = memberKey(member)
        const text = normalize(printer.printNode(ts.EmitHint.Unspecified, member, file), file.fileName)
        if (moduleName === '@deepseek-ai/cordis' && inner.name.text === 'Events') {
          const events = contract.events[pkg] ??= {}
          const previous = Object.hasOwn(events, name) ? events[name] : undefined
          events[name] = { mode: previous?.mode ?? modeOf(member), signature: joinOverload(previous?.signature, text) }
        } else if (moduleName === '@deepseek-ai/cordis' && inner.name.text === 'Context') {
          const services = contract.services[pkg] ??= {}
          services[name] = joinOverload(Object.hasOwn(services, name) ? services[name] : undefined, text)
        } else {
          const api = contract.api[pkg]
          const members = api === undefined ? undefined : api.augmentations[`${moduleName}#${inner.name.text}`] ??= {}
          if (members !== undefined) members[name] = joinOverload(Object.hasOwn(members, name) ? members[name] : undefined, text)
        }
      }
    }
  }
}

function generateTypes(packages: readonly ResolvedPackage[], contract: Contract): void {
  const entries = packages.flatMap(pkg => Object.values(pkg.exports).flatMap(target => (target.types === undefined ? [] : [resolve(pkg.dir, target.types)])))
  const program = ts.createProgram(entries, {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    exactOptionalPropertyTypes: true,
    skipLibCheck: true,
    noEmit: true,
    // Both trees read Node's types from the workspace, so a type from node:* prints the same on either side.
    typeRoots: [join(repoRoot, 'node_modules', '@types')],
    types: ['node'],
  })
  const checker = program.getTypeChecker()
  for (const pkg of packages) {
    const api: PackageApi = { exports: {}, augmentations: {} }
    contract.api[pkg.name] = api
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (target.types === undefined) continue
      const file = program.getSourceFile(resolve(pkg.dir, target.types))
      const moduleSymbol = file === undefined ? undefined : checker.getSymbolAtLocation(file)
      if (moduleSymbol === undefined) throw new Error(`${pkg.name}${subpath.slice(1)}: ${target.types} is not a module`)
      const described: Record<string, string | Record<string, string>> = {}
      for (const symbol of checker.getExportsOfModule(moduleSymbol)) described[symbol.name] = describeExport(checker, symbol)
      api.exports[subpath] = described
    }
    const own = `${pkg.dir}${sep}`
    for (const file of program.getSourceFiles()) {
      if (file.fileName.startsWith(own) && !file.fileName.slice(own.length).includes(`node_modules${sep}`)) collectAugmentations(file, pkg.name, contract)
    }
  }
}

const SCHEMASTERY = Symbol.for('schemastery')

interface SchemaJson { uid: number; refs: Record<string, Record<string, unknown>> }

function isSchema(value: unknown): value is { toJSON(): SchemaJson } {
  return (typeof value === 'function' || typeof value === 'object') && value !== null && (value as Record<symbol, unknown>)[SCHEMASTERY] === true
}

/**
 * schemastery serializes a schema as `{ uid, refs }` with process-local uids;
 * renumber them in first-visit order so equal schemas serialize equally.
 */
function canonicalSchema(schema: { toJSON(): SchemaJson }): unknown {
  const { uid, refs } = schema.toJSON()
  const order = new Map<number, number>()
  const visit = (id: number): number => {
    const known = order.get(id)
    if (known !== undefined) return known
    order.set(id, order.size)
    const node = refs[String(id)] ?? {}
    for (const key of ['inner', 'sKey'] as const) if (typeof node[key] === 'number') visit(node[key])
    if (Array.isArray(node['list'])) for (const item of node['list']) if (typeof item === 'number') visit(item)
    if (node['dict'] !== undefined) for (const item of Object.values(node['dict'] as Record<string, unknown>)) if (typeof item === 'number') visit(item)
    return order.size - 1
  }
  visit(uid)
  const remap = (value: unknown): unknown => (typeof value === 'number' ? order.get(value) : value)
  const nodes = [...order.entries()].sort(([, a], [, b]) => a - b).map(([id]) => {
    const node = { ...refs[String(id)] }
    delete node['uid']
    for (const key of ['inner', 'sKey'] as const) if (node[key] !== undefined) node[key] = remap(node[key])
    if (Array.isArray(node['list'])) node['list'] = node['list'].map(remap)
    if (node['dict'] !== undefined) node['dict'] = Object.fromEntries(Object.entries(node['dict'] as Record<string, unknown>).map(([key, value]) => [key, remap(value)]))
    return node
  })
  return nodes
}

function pluginContract(value: Record<string, unknown>, withName: boolean): PluginRuntimeContract | undefined {
  const contract: PluginRuntimeContract = {}
  if (withName && value['name'] !== undefined) contract.name = value['name']
  if (value['inject'] !== undefined) contract.inject = value['inject']
  if (isSchema(value['Config'])) contract.Config = canonicalSchema(value['Config'])
  return contract.inject === undefined && contract.Config === undefined && contract.name === undefined ? undefined : contract
}

async function generateRuntime(packages: readonly ResolvedPackage[], contract: Contract): Promise<void> {
  for (const pkg of packages) {
    const bySubpath: Record<string, Record<string, PluginRuntimeContract>> = {}
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (target.default === undefined) continue
      const module = await import(pathToFileURL(resolve(pkg.dir, target.default)).href) as Record<string, unknown>
      const found: Record<string, PluginRuntimeContract> = {}
      const own = pluginContract(module, true)
      if (own !== undefined && (typeof module['apply'] === 'function' || module['Config'] !== undefined || module['inject'] !== undefined)) found['$module'] = own
      for (const [exportName, value] of Object.entries(module)) {
        if (typeof value !== 'function') continue
        const plugin = pluginContract(value as unknown as Record<string, unknown>, false)
        if (plugin !== undefined) found[exportName] = plugin
      }
      if (Object.keys(found).length > 0) bySubpath[subpath] = found
    }
    contract.config[pkg.name] = bySubpath
  }
}

/** Generate the contract of the kernel packages as `root` resolves them. */
export async function generateContract(root: string): Promise<Contract> {
  const packages = resolvePackages(root)
  const contract: Contract = { api: {}, services: {}, events: {}, config: {} }
  generateTypes(packages, contract)
  await generateRuntime(packages, contract)
  return contract
}

export function writeContract(contract: Contract, outDir: string): void {
  mkdirSync(outDir, { recursive: true })
  for (const file of CONTRACT_FILES) writeFileSync(join(outDir, `${file}.json`), stableJson(contract[file]))
}

async function main(): Promise<void> {
  const [root, out] = process.argv.slice(2)
  if (root === undefined || out === undefined) throw new Error('usage: contract-gen.ts <tree root> <out dir>')
  writeContract(await generateContract(resolve(root)), resolve(out))
  console.log(`contract of ${String(kernelPackages().length)} kernel packages from ${root} written to ${out}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
