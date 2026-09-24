/**
 * @boat/distro — the `boatDistro` marker service. Its presence tells a plugin
 * that it runs on boat's kernel; its content names the dsh release the kernel
 * was imported from and the kernel extensions this build carries
 * (compatibility/contract/extensions.yml, compiled into `distro-manifest.ts`). A plugin that
 * uses an extension declares `inject: ['boatDistro']`: the official release
 * has no such service, so there the plugin waits instead of calling an
 * extension that is not there.
 * @module @boat/distro
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { BoatDistro, BoatDistroExtension } from '@boat/contracts'
import { DISTRO_EXTENSIONS, DSH_BASE } from './distro-manifest.ts'

export class BoatDistroService extends Service implements BoatDistro {
  readonly dsh: string = DSH_BASE
  readonly extensions: readonly BoatDistroExtension[] = DISTRO_EXTENSIONS

  constructor(ctx: Context) {
    super(ctx, 'boatDistro')
  }

  has(id: string): boolean {
    return this.extensions.some(extension => extension.id === id)
  }
}

export default BoatDistroService
