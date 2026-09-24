/**
 * @lyteboat/distro — the `lyteboatDistro` marker service. Its presence tells a plugin
 * that it runs on lyteboat's kernel; its content names the dsh release the kernel
 * was imported from and the kernel extensions this build carries
 * (compatibility/contract/extensions.yml, compiled into `distro-manifest.ts`). A plugin that
 * uses an extension declares `inject: ['lyteboatDistro']`: the official release
 * has no such service, so there the plugin waits instead of calling an
 * extension that is not there.
 * @module @lyteboat/distro
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { LyteboatDistro, LyteboatDistroExtension } from '@lyteboat/contracts'
import { DISTRO_EXTENSIONS, DSH_BASE } from './distro-manifest.ts'

export class LyteboatDistroService extends Service implements LyteboatDistro {
  readonly dsh: string = DSH_BASE
  readonly extensions: readonly LyteboatDistroExtension[] = DISTRO_EXTENSIONS

  constructor(ctx: Context) {
    super(ctx, 'lyteboatDistro')
  }

  has(id: string): boolean {
    return this.extensions.some(extension => extension.id === id)
  }
}

export default LyteboatDistroService
