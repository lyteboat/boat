/**
 * The collapse affordance of a list-and-detail section's left list, as the
 * original Studio draws it: {@link useStudioRailCollapse} keeps whether a list
 * is collapsed (per key, in `localStorage`, so the choice outlives a
 * navigation); {@link StudioRailToggle} collapses it from the list's heading;
 * {@link StudioCollapsedRail} is the thin strip shown in its place, which
 * expands it on click. The section adds `list-collapsed` to its grid while the
 * list is collapsed.
 * @module @lyteboat/studio-web/client/studio-collapsible-rail
 */

import { useCallback, useState } from 'react'
import { ChevronRightIcon } from './studio-icons.tsx'

const STUDIO_RAIL_STORAGE_PREFIX = 'lyteboat-studio:rail:'

function storedStudioRailCollapsed(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === '1'
  } catch {
    // Storage is off (a private window with storage blocked): every list opens expanded.
    return false
  }
}

function keepStudioRailCollapsed(storageKey: string, collapsed: boolean): void {
  try {
    localStorage.setItem(storageKey, collapsed ? '1' : '0')
  } catch {
    // Storage is off or full: the choice lasts only as long as the page.
  }
}

/**
 * Whether a list is collapsed, and the toggle that flips it.
 * @param key - the list's name, unique across the pages (`agent-skills`).
 * @returns `[collapsed, toggle]`.
 */
export function useStudioRailCollapse(key: string): [boolean, () => void] {
  const storageKey = `${STUDIO_RAIL_STORAGE_PREFIX}${key}`
  const [collapsed, setCollapsed] = useState(() => storedStudioRailCollapsed(storageKey))
  const toggle = useCallback(() => {
    const next = !collapsed
    setCollapsed(next)
    keepStudioRailCollapsed(storageKey, next)
  }, [collapsed, storageKey])
  return [collapsed, toggle]
}

/** The chevron in an expanded list's heading; it points inward, toward the collapse. */
export function StudioRailToggle({ label, onToggle }: { label: string; onToggle(): void }) {
  return (
    <button aria-label={label} className="studio-rail-toggle" onClick={onToggle} title={label} type="button">
      <ChevronRightIcon style={{ transform: 'rotate(180deg)' }} />
    </button>
  )
}

/** The strip in place of a collapsed list: its item count and its name, written vertically. */
export function StudioCollapsedRail({ label, count, onExpand }: { label: string; count: number; onExpand(): void }) {
  return (
    <button aria-label={`Expand ${label}`} className="studio-rail-collapsed" onClick={onExpand} title={`Expand ${label}`} type="button">
      <span className="studio-rail-collapsed-chevron"><ChevronRightIcon /></span>
      <span className="studio-rail-collapsed-count">{count}</span>
      <span className="studio-rail-collapsed-label">{label}</span>
    </button>
  )
}
