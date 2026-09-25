/**
 * The pages' inline styles over dsh web's theme tokens (`--dsw-alias-*`):
 * a plugin bundle loads outside dsh web's own style build, so the pages style
 * themselves inline and follow the light and dark themes through the tokens.
 * @module @lyteboat/studio-pages/client/studio-styles
 */

import type { CSSProperties } from 'react'

export const pageStyle: CSSProperties = {
  height: '100%', overflow: 'auto', padding: '24px 32px', boxSizing: 'border-box',
  color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)', fontSize: 14,
}

export const headerStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }

export const titleStyle: CSSProperties = { margin: 0, fontSize: 20, fontWeight: 600 }

export const sectionTitleStyle: CSSProperties = { margin: '20px 0 8px', fontSize: 14, fontWeight: 600 }

export const listStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }

export const rowStyle: CSSProperties = { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '10px 12px' }

export const mutedStyle: CSSProperties = { color: 'var(--dsw-alias-label-secondary)', margin: '4px 0 0' }

export const errorStyle: CSSProperties = { color: 'var(--dsw-alias-state-error-primary)', margin: '8px 0' }

export const preStyle: CSSProperties = {
  margin: 0, padding: 10, borderRadius: 6, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  fontSize: 12, background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)',
}

export const fieldStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 6, fontFamily: 'inherit', fontSize: 13, resize: 'vertical',
  color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)',
}
