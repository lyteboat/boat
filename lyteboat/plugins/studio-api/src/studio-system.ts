/**
 * The System page's answer: the machine, the Node.js runtime, the lyteboat
 * build and where it keeps its data, and the environment with its secrets
 * masked. Read fresh on every request.
 * @module @lyteboat/studio-api/studio-system
 */

import { arch, availableParallelism, endianness, freemem, hostname, machine, release, totalmem, type, version } from 'node:os'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { LyteboatDistro } from '@lyteboat/contracts'
import type { StudioSystemAnswer } from '@lyteboat/contracts/studio'
import { maskStudioEnvValue } from './studio-env-masking.ts'

/** What the System page shows besides the machine. */
export interface StudioSystemFacts {
  distro: LyteboatDistro
  lyteboatVersion: string | undefined
  agentRoots: readonly string[]
  /** Variables shown masked whatever their names (a credential reference Studio itself reads). */
  maskedEnv: readonly string[]
  env: Readonly<Record<string, string | undefined>>
}

/** Build the answer of `GET system/properties`. */
export function studioSystemAnswer(facts: StudioSystemFacts): StudioSystemAnswer {
  const masked = new Set(facts.maskedEnv)
  return {
    os: { type: type(), platform: process.platform, release: release(), version: version(), machine: machine(), arch: arch(), hostname: hostname() },
    runtime: { node: process.version, v8: process.versions.v8, execPath: process.execPath, pid: process.pid, uptimeSeconds: Math.round(process.uptime()) },
    lyteboat: {
      ...facts.lyteboatVersion === undefined ? {} : { version: facts.lyteboatVersion },
      dshBase: facts.distro.dsh,
      extensions: facts.distro.extensions.map(extension => extension.id),
      home: dshHomePath(),
      agentRoots: [...facts.agentRoots],
    },
    properties: {
      cpuCount: availableParallelism(),
      endianness: endianness(),
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      cwd: process.cwd(),
      execArgv: [...process.execArgv],
    },
    env: Object.entries(facts.env)
      .flatMap(([name, value]) => value === undefined ? [] : [{ name, value: masked.has(name) ? '***' : maskStudioEnvValue(name, value) }])
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  }
}
