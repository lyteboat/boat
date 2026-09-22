#!/usr/bin/env node
/**
 * Command-line entry for boat. The home module is the only static import so
 * that `DSH_HOME` is exported before any dsh package is evaluated.
 * @module @boat/cli/bin
 */

import { installBoatHome } from './home.ts'

installBoatHome()
const { runCli } = await import('./cli.ts')
await runCli()
