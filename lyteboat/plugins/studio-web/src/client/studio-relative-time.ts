/**
 * How long ago a moment was, said the way the original Studio says it on its
 * cards and chips: just now, then minutes, hours, or days.
 * @module @lyteboat/studio-web/client/studio-relative-time
 */

/**
 * @param epochMs - the moment, in milliseconds since the epoch.
 * @returns `just now`, `12m ago`, `3h ago`, or `2d ago`.
 */
export function formatStudioRelativeTime(epochMs: number): string {
  const minutes = Math.floor((Date.now() - epochMs) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  return `${String(Math.floor(hours / 24))}d ago`
}
