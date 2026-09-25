#!/usr/bin/env node
/**
 * Command-line entry for lyteboat. The home module is the only static import so
 * that `DSH_HOME` is exported before any dsh package is evaluated.
 * @module @lyteboat/cli/bin
 */

import { installLyteboatHome } from './home.ts'

installLyteboatHome()
const { runCli } = await import('./cli.ts')
await runCli()
