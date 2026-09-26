/**
 * The Users page (admins), as the original Studio's: the role grants in a
 * searchable, filterable table of 50 a page, and a side form that grants a
 * role or changes one. Nobody edits or deletes their own row, and the last
 * admin can be neither demoted nor deleted; the server enforces both, the page
 * only shows them.
 * @module @lyteboat/studio-web/client/studio-users-page
 */

import { useCallback, useEffect, useState } from 'react'
import type { StudioGrant, StudioRole } from '@lyteboat/contracts/studio'
import { studioApi, studioErrorMessage } from './studio-api-client.ts'
import { canManageStudioUsers, useStudioAuth } from './studio-auth-context.tsx'
import { useStudioConfirm } from './studio-confirm-dialog.tsx'
import { PlusIcon, RefreshIcon, SearchIcon } from './studio-icons.tsx'

type StudioRoleFilter = StudioRole | 'all'

const STUDIO_ROLE_OPTIONS: readonly StudioRole[] = ['admin', 'editor', 'viewer']
const USERS_PAGE_SIZE = 50

/** A select's value as a role; the options hold only roles. */
function studioRoleOf(value: string): StudioRole | undefined {
  return STUDIO_ROLE_OPTIONS.find(role => role === value)
}

function roleBadgeClass(role: StudioRole): string {
  if (role === 'admin') return 'badge err'
  if (role === 'editor') return 'badge accent'
  return 'badge'
}

/** One page of grants and the query that selects it. */
function useStudioUsers(enabled: boolean) {
  const [users, setUsers] = useState<StudioGrant[]>([])
  const [total, setTotal] = useState(0)
  const [adminCount, setAdminCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<StudioRoleFilter>('all')
  const [offset, setOffset] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const page = await studioApi.users({ text: query.trim(), role: roleFilter === 'all' ? undefined : roleFilter, limit: USERS_PAGE_SIZE, offset })
      setUsers(page.users)
      setTotal(page.total)
      setAdminCount(page.adminCount)
    } catch (nextError: unknown) {
      setError(studioErrorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }, [offset, query, roleFilter])

  useEffect(() => {
    if (enabled) void load()
    else setLoading(false)
  }, [enabled, load])

  return {
    users, total, adminCount, loading, error, setError, query, roleFilter, offset, setOffset, load,
    search: (text: string) => { setQuery(text); setOffset(0) },
    filter: (role: StudioRoleFilter) => { setRoleFilter(role); setOffset(0) },
  }
}

type StudioUsersState = ReturnType<typeof useStudioUsers>

interface StudioGrantDraft {
  mode: 'create' | 'edit'
  userId: string
  role: StudioRole
}

function StudioUsersTable({ state, currentUserId, editing, busy, edit, remove }: { state: StudioUsersState; currentUserId: string | undefined; editing: string | undefined; busy: boolean; edit(grant: StudioGrant): void; remove(grant: StudioGrant): void }) {
  const pageEnd = Math.min(state.offset + state.users.length, state.total)
  return (
    <div className="workspace-surface users-table-panel">
      <div className="filter-bar">
        <label className="search">
          <SearchIcon />
          <input aria-label="Search users" onChange={event => state.search(event.target.value)} placeholder="Search user ID" value={state.query} />
        </label>
        <select aria-label="Filter by role" className="field-input users-role-filter" onChange={event => state.filter(studioRoleOf(event.target.value) ?? 'all')} value={state.roleFilter}>
          <option value="all">All roles</option>
          {STUDIO_ROLE_OPTIONS.map(role => <option key={role} value={role}>{role}</option>)}
        </select>
      </div>
      {state.loading && <div className="empty-surface">Loading users...</div>}
      {state.error !== null && <div className="feedback-banner feedback-banner-error">{state.error}</div>}
      {!state.loading && state.error === null && state.users.length === 0 && <div className="empty-surface">No user role grants found.</div>}
      {!state.loading && state.users.length > 0 && (
        <div className="users-table-shell">
          <table className="users-table">
            <thead>
              <tr><th>User ID</th><th>Role</th><th>Updated By</th><th>Updated At</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {state.users.map((grant) => {
                const lastAdmin = grant.role === 'admin' && state.adminCount <= 1
                return (
                  <tr className={grant.userId === editing ? 'selected' : ''} key={grant.userId}>
                    <td><code>{grant.userId}</code></td>
                    <td><span className={roleBadgeClass(grant.role)}>{grant.role}</span></td>
                    <td>{grant.updatedBy}</td>
                    <td>{new Date(grant.updatedAt).toLocaleString()}</td>
                    <td>
                      <div className="button-row">
                        {grant.userId === currentUserId ? <span className="badge">Current user</span> : (
                          <>
                            <button className="action-button" onClick={() => edit(grant)} type="button">Edit</button>
                            <button className="action-button action-button-danger" disabled={lastAdmin || busy} onClick={() => remove(grant)} title={lastAdmin ? 'At least one admin is required' : 'Delete role grant'} type="button">Delete</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="users-pagination">
        <span>{state.total === 0 ? '0 users' : `${String(state.offset + 1)}-${String(pageEnd)} of ${String(state.total)}`}</span>
        <div className="button-row">
          <button className="action-button" disabled={state.offset === 0 || state.loading} onClick={() => state.setOffset(Math.max(0, state.offset - USERS_PAGE_SIZE))} type="button">Previous</button>
          <button className="action-button" disabled={pageEnd >= state.total || state.loading} onClick={() => state.setOffset(state.offset + USERS_PAGE_SIZE)} type="button">Next</button>
        </div>
      </div>
    </div>
  )
}

function StudioGrantForm({ open, draft, lastAdmin, busy, feedback, change, save, cancel }: { open: boolean; draft: StudioGrantDraft; lastAdmin: boolean; busy: boolean; feedback: string | null; change(draft: StudioGrantDraft): void; save(): void; cancel(): void }) {
  return (
    <aside aria-hidden={!open} className={`workspace-surface users-form-panel ${open ? 'open' : 'collapsed'}`} id="grant-user-role-panel">
      {feedback !== null && <div className="feedback-banner">{feedback}</div>}
      <div className="editor-sheet">
        <div className="surface-heading"><span>{draft.mode === 'create' ? 'Grant User Role' : 'Edit User Role'}</span></div>
        <label className="form-field">
          <span>User ID</span>
          <input disabled={draft.mode === 'edit'} onChange={event => change({ ...draft, userId: event.target.value })} placeholder="Enter user ID" value={draft.userId} />
        </label>
        <label className="form-field">
          <span>Role</span>
          <select disabled={lastAdmin} onChange={event => change({ ...draft, role: studioRoleOf(event.target.value) ?? draft.role })} value={draft.role}>
            {STUDIO_ROLE_OPTIONS.map(role => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
        {lastAdmin && <div className="feedback-banner">At least one admin is required.</div>}
        <div className="button-row">
          <button className="action-button action-button-primary" disabled={busy || draft.userId.trim() === ''} onClick={save} type="button">{busy ? 'Saving...' : 'Save Grant'}</button>
          <button className="action-button" onClick={cancel} type="button">Cancel</button>
        </div>
      </div>
    </aside>
  )
}

const EMPTY_DRAFT: StudioGrantDraft = { mode: 'create', userId: '', role: 'viewer' }

/** The page at `/users`. */
export function StudioUsersPage() {
  const { user } = useStudioAuth()
  const confirm = useStudioConfirm()
  const canManage = canManageStudioUsers(user?.role)
  const state = useStudioUsers(canManage)
  const [formOpen, setFormOpen] = useState(true)
  const [draft, setDraft] = useState<StudioGrantDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const editedRole = state.users.find(grant => grant.userId === draft.userId)?.role
  const lastAdmin = draft.mode === 'edit' && editedRole === 'admin' && state.adminCount <= 1

  function openForm(next: StudioGrantDraft): void {
    setDraft(next)
    setFormOpen(true)
    setFeedback(null)
    state.setError(null)
  }

  async function save(): Promise<void> {
    setBusy(true)
    setFeedback(null)
    state.setError(null)
    try {
      const saved = await studioApi.grant({ userId: draft.userId.trim(), role: draft.role })
      setFeedback(`Saved role for ${saved.userId}`)
      setDraft({ mode: 'edit', userId: saved.userId, role: saved.role })
      await state.load()
    } catch (nextError: unknown) {
      state.setError(studioErrorMessage(nextError))
    } finally {
      setBusy(false)
    }
  }

  async function remove(grant: StudioGrant): Promise<void> {
    if (!await confirm({ title: 'Delete role grant', message: `Remove the role grant for ${grant.userId}?`, tone: 'danger', confirmLabel: 'Delete' })) return
    setBusy(true)
    setFeedback(null)
    try {
      await studioApi.revoke(grant.userId)
      setFeedback(`Deleted role grant for ${grant.userId}`)
      setDraft(EMPTY_DRAFT)
      setFormOpen(false)
      await state.load()
    } catch (nextError: unknown) {
      state.setError(studioErrorMessage(nextError))
    } finally {
      setBusy(false)
    }
  }

  if (!canManage) return <section className="users-page"><div className="empty-surface">Access denied.</div></section>
  const creating = formOpen && draft.mode === 'create'
  return (
    <section className="users-page">
      <div className="users-page-header">
        <div>
          <h1>Users</h1>
          <p>Grant Studio roles by user ID.</p>
        </div>
        <div className="button-row">
          <button className="action-button" onClick={() => void state.load()} type="button"><RefreshIcon />Refresh</button>
          <button aria-controls="grant-user-role-panel" aria-expanded={creating} className={`action-button action-button-primary users-grant-toggle ${creating ? 'open' : ''}`} onClick={() => { if (creating) setFormOpen(false); else openForm(EMPTY_DRAFT) }} title={creating ? 'Collapse grant form' : 'Grant role'} type="button">
            <PlusIcon />Grant Role
          </button>
        </div>
      </div>
      <section className={`users-layout ${formOpen ? 'users-layout-form-open' : 'users-layout-form-collapsed'}`}>
        <StudioUsersTable busy={busy} currentUserId={user?.userId} editing={formOpen && draft.mode === 'edit' ? draft.userId : undefined} edit={grant => openForm({ mode: 'edit', userId: grant.userId, role: grant.role })} remove={grant => void remove(grant)} state={state} />
        <StudioGrantForm busy={busy} cancel={() => { setFormOpen(false); setDraft(EMPTY_DRAFT) }} change={setDraft} draft={draft} feedback={feedback} lastAdmin={lastAdmin} open={formOpen} save={() => void save()} />
      </section>
    </section>
  )
}
