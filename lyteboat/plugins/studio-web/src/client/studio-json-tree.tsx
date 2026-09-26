/**
 * A JSON value as a tree, drawn as the original Studio draws a tool's output:
 * leaves colored by type, arrays and objects as toggles (open at the top level,
 * closed below it) naming their size.
 * @module @lyteboat/studio-web/client/studio-json-tree
 */

import { useState } from 'react'
import type { JsonValue } from '@lyteboat/contracts'
import { ChevronRightIcon } from './studio-icons.tsx'

function StudioJsonBranch({ tag, entries, depth }: { tag: string; entries: [string, JsonValue][]; depth: number }) {
  const [open, setOpen] = useState(depth === 0)
  return (
    <div className="json-node">
      <button aria-expanded={open} className={`json-node-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(current => !current)} type="button">
        <ChevronRightIcon className="json-node-chevron" />
        <span className="json-type-tag">{tag}</span>
      </button>
      {open && (
        <ul className="json-node-children">
          {entries.map(([key, child]) => (
            <li className="json-node-row" key={key}>
              <span className="json-key">{key}</span>
              <StudioJsonTree depth={depth + 1} value={child} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The tree of `value`; `depth` is how deep it sits in an enclosing tree. */
export function StudioJsonTree({ value, depth = 0 }: { value: JsonValue; depth?: number }) {
  if (value === null) return <span className="json-leaf json-null">null</span>
  if (typeof value === 'string') return <span className="json-leaf json-string">"{value}"</span>
  if (typeof value === 'number') return <span className="json-leaf json-number">{String(value)}</span>
  if (typeof value === 'boolean') return <span className="json-leaf json-boolean">{String(value)}</span>
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="json-leaf json-empty">[]</span>
    return <StudioJsonBranch depth={depth} entries={value.map((child, index) => [String(index), child])} tag={`[${String(value.length)} items]`} />
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return <span className="json-leaf json-empty">{'{}'}</span>
  return <StudioJsonBranch depth={depth} entries={entries} tag={`{${String(entries.length)} keys}`} />
}
