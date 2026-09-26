/**
 * How the Sessions pages say a session's facts: its owner (`user:alice`, or
 * `(anonymous)` when no request named one), a message cut to one line, a
 * duration in seconds, and a moment in local time, the way the original
 * Studio says them on its rows and timeline.
 * @module @lyteboat/studio-web/client/studio-session-format
 */

import type { LyteboatRequestOwner } from '@lyteboat/contracts'

/** A model answer or a tool call this long or longer is slow, as the server counts `slowCount`. */
export const STUDIO_SESSION_SLOW_MS = 10_000

/** An owner as the list groups by it: `kind:id`, or `(anonymous)`. */
export function studioSessionOwnerLabel(owner: LyteboatRequestOwner | undefined): string {
  return owner === undefined ? '(anonymous)' : `${owner.kind}:${owner.id}`
}

/**
 * @param value - the text.
 * @param max - the longest result, the ellipsis included.
 * @returns the text on one line, its runs of whitespace collapsed, cut with `…` past `max`.
 */
export function summarizeStudioSessionText(value: string, max = 96): string {
  const collapsed = value.replace(/\s+/gu, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

/** `1.2s`. */
export function formatStudioSessionSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/** A moment in the browser's locale and time zone. */
export function formatStudioSessionTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString()
}

/** A turn number as the timeline's gutter shows it: `01`. */
export function formatStudioSessionTurn(turn: number): string {
  return String(turn).padStart(2, '0')
}
