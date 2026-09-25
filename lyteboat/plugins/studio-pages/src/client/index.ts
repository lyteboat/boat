/**
 * The Studio pages in dsh web's browser: the Agents and Evals pages as main
 * panels with their sidebar entries, and the lyteboat tab of a session's right
 * sidebar. Every registration goes through dsh's slots and tab registry and is
 * an effect, so unloading the row removes the pages.
 * @module @lyteboat/studio-pages/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { AgentsIcon, AgentsPage, type StudioPagesInjected } from './AgentsPage.tsx'
import { EvalsIcon, EvalsPage } from './EvalsPage.tsx'
import { SessionTab } from './SessionTab.tsx'
import { studioPagesClient } from './studio-pages-client.ts'

/** The Agents page's panel id: its sidebar entry and its main-panel key. */
export const STUDIO_AGENTS_PANEL = 'lyteboat-agents' as MainPanelId

/** The Evals page's panel id. */
export const STUDIO_EVALS_PANEL = 'lyteboat-evals' as MainPanelId

/** The session tab's identity in dsh's tab system: the key its body registers under. */
export const STUDIO_SESSION_TAB_ID = '@lyteboat/studio-pages/session'

/** The session tab's kind. */
export const STUDIO_SESSION_TAB_KIND = 'lyteboat'

// `connection` is read with ctx.get: its browser half declares no Context property.
export const inject = ['slots', 'sidebarRightTabs', 'connection']

/**
 * Register the pages.
 * @param ctx - the browser plugin's context.
 */
export function apply(ctx: Context): void {
  // The browser half of dsh's connection, which `inject` waits for.
  const connection = ctx.get('connection') as ConnectionHandle
  const injected: StudioPagesInjected = { studio: studioPagesClient(connection) }

  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: STUDIO_AGENTS_PANEL, inject: () => injected }, AgentsPage)), 'studio-pages: agents page')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: STUDIO_AGENTS_PANEL, order: 40, label: 'Agents' }, AgentsIcon)), 'studio-pages: agents entry')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: STUDIO_EVALS_PANEL, inject: () => injected }, EvalsPage)), 'studio-pages: evals page')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: STUDIO_EVALS_PANEL, order: 41, label: 'Evals' }, EvalsIcon)), 'studio-pages: evals entry')

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: STUDIO_SESSION_TAB_ID,
    kind: STUDIO_SESSION_TAB_KIND,
    title: () => 'lyteboat',
    guide: [{
      id: 'lyteboat',
      order: 90,
      title: () => 'lyteboat',
      description: () => 'Send a message with its request context; the session\'s skill, request, cards, and state',
    }],
  }), 'studio-pages: session tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: STUDIO_SESSION_TAB_ID, inject: () => injected }, SessionTab)), 'studio-pages: session tab')
}
