import { fileURLToPath } from 'node:url'
import { boatLauncher } from '@boat/testing/process'

/** The built launcher entry: tests exercise the published artifact under plain Node. */
export const BOAT_BIN = fileURLToPath(new URL('../../lib/bin.js', import.meta.url))

export const { startBoat, runBoat } = boatLauncher(BOAT_BIN)
