/**
 * Temporary directories for one test file: a root under the OS temporary
 * directory, created on first use, and a fresh harness home and workspace per
 * run label. Composition and e2e tests point `DSH_HOME` / `LYTEBOAT_HOME` at the
 * home and run in the workspace, so no run sees another's sessions or files.
 * @module @lyteboat/testing/scratch
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** One run's directories. */
export interface LyteboatScratchRun {
  /** The harness home the run writes its sessions under. */
  readonly home: string
  /** The working directory: a README.md naming the scratch, then the run's own files. */
  readonly workspace: string
}

/** A test file's temporary tree. */
export interface LyteboatScratch {
  /** The root directory, for files the file's runs share; created on first use. */
  readonly root: string
  /**
   * Empty `home-<label>` and `workspace-<label>` under the root, recreated when a label repeats.
   * @param label - names the run's directories.
   * @param files - workspace files by relative path, parent directories created.
   * @returns the run's home and workspace.
   */
  run(label: string, files?: Readonly<Record<string, string>>): LyteboatScratchRun
  /** Remove the root and everything under it; a later use creates a new root. */
  remove(): void
}

/**
 * Create a test file's temporary tree; nothing touches the disk until it is used.
 * @param name - names the root (`lyteboat-<name>-*`) and heads the workspace README.
 * @returns the tree.
 */
export function createLyteboatScratch(name: string): LyteboatScratch {
  let root: string | undefined
  const rootDir = (): string => {
    root ??= mkdtempSync(join(tmpdir(), `lyteboat-${name}-`))
    return root
  }
  return {
    get root() { return rootDir() },
    run(label, files = {}) {
      const home = join(rootDir(), `home-${label}`)
      const workspace = join(rootDir(), `workspace-${label}`)
      for (const dir of [home, workspace]) {
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(join(workspace, 'README.md'), `# ${name} workspace\n`)
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(workspace, path)), { recursive: true })
        writeFileSync(join(workspace, path), text)
      }
      return { home, workspace }
    },
    remove() {
      if (root !== undefined) rmSync(root, { recursive: true, force: true })
      root = undefined
    },
  }
}
