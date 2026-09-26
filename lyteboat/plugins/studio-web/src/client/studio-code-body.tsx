/**
 * A block of code or text with a copy button floating at its top right, as the
 * original Studio shows a SKILL.md or a tool's parameters. The button copies
 * `value`, which may differ from what the block shows (an empty file shows a
 * note, and copies nothing).
 * @module @lyteboat/studio-web/client/studio-code-body
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CopyIcon } from './studio-icons.tsx'

const STUDIO_COPIED_MS = 1200

async function copyStudioText(value: string): Promise<void> {
  // The Clipboard API exists only in a secure context; a Studio served over plain
  // HTTP on an internal host copies through a hidden textarea instead.
  if (window.isSecureContext) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function StudioCopyButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async (): Promise<void> => {
    try {
      await copyStudioText(value)
    } catch {
      // The browser refused the copy (a permission prompt dismissed): the button keeps saying "Copy".
      setCopied(false)
      return
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), STUDIO_COPIED_MS)
  }

  return (
    <button aria-label={`Copy ${title}`} className="icon-action-button" onClick={() => void copy()} title={copied ? `${title} copied` : `Copy ${title}`} type="button">
      <CopyIcon />
    </button>
  )
}

/** A code block whose copy button copies `value`. */
export function StudioCodeBody({ value, children }: { value: string; children: ReactNode }) {
  return (
    <div className="code-body">
      <div className="code-body-actions">
        <StudioCopyButton title="content" value={value} />
      </div>
      {children}
    </div>
  )
}
