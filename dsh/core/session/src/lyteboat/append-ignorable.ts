/**
 * lyteboat's extension `session-append-ignorable` (dsh-compat/contract/extensions.yml):
 * the write path for `SessionEvent.ignorable`. The read and seed paths already
 * skip an unknown event that carries the marker; `Session.append` could not set
 * it, so a plugin's own record type made its session unreadable. A purely
 * informational record of a type this build does not know now asks for the marker.
 * @module @deepseek-ai/dsh-session/lyteboat/append-ignorable
 */

import { KNOWN_SESSION_EVENT_TYPES } from '../known-event-types.ts'
import type { SurfaceIntent } from '../types.ts'

/** What `Session.append` takes for a non-surface type: the ignorable marker. */
export interface LyteboatAppendOptions {
  /** A reader that does not know the type skips the record instead of refusing the log. */
  readonly ignorable: true
}

/**
 * Split one append's trailing argument into the surface intent upstream reads
 * and the envelope marker a lyteboat record asks for. Anything but an explicit
 * `ignorable: true` passes through exactly as upstream receives it.
 * @param type - the event type being appended.
 * @param options - the trailing argument as the caller passed it.
 * @returns the surface intent upstream validates, and the fields to spread into the envelope.
 * @throws when a type this build knows asks for the marker: a reader would skip a required event.
 */
export function lyteboatAppendOptions(type: string, options: unknown): { surface: SurfaceIntent | undefined; marker: { ignorable?: true } } {
  // Upstream reads only surfaceOp and sourceEventSeqs from this object; the marker request adds neither.
  const surface = options as SurfaceIntent | undefined
  if (!isMarkerRequest(options)) return { surface, marker: {} }
  if (KNOWN_SESSION_EVENT_TYPES.has(type)) {
    throw new Error(`session event "${type}" is known to this harness and cannot be marked ignorable`)
  }
  return { surface, marker: { ignorable: true } }
}

function isMarkerRequest(options: unknown): options is LyteboatAppendOptions {
  return typeof options === 'object' && options !== null && (options as { ignorable?: unknown }).ignorable === true
}
