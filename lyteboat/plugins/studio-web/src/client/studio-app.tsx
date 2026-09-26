/**
 * The pages' routes under `/studio`: `/login` for everyone; the rest behind a
 * sign-in, inside the shell: the Dashboard, Users, System, and an agent's
 * workspace (`/agents/:agentId` opens its overview).
 * @module @lyteboat/studio-web/client/studio-app
 */

import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useStudioAuth } from './studio-auth-context.tsx'
import { StudioLoginPage } from './studio-login-page.tsx'
import { StudioAgentPage, StudioDashboardPage } from './studio-pending-pages.tsx'
import { StudioShell } from './studio-shell.tsx'
import { StudioSystemPage } from './studio-system-page.tsx'
import { StudioUsersPage } from './studio-users-page.tsx'

function StudioSignedInRoute() {
  const { user, initializing } = useStudioAuth()
  const location = useLocation()
  if (initializing) return null
  if (user === null) return <Navigate replace to={`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`} />
  return <Outlet />
}

/** The route table. */
export function StudioApp() {
  return (
    <Routes>
      <Route element={<StudioLoginPage />} path="/login" />
      <Route element={<StudioSignedInRoute />}>
        <Route element={<StudioShell />} path="/">
          <Route element={<StudioDashboardPage />} index />
          <Route element={<StudioUsersPage />} path="users" />
          <Route element={<StudioSystemPage />} path="system" />
          <Route element={<Navigate replace to="overview" />} path="agents/:agentId" />
          <Route element={<StudioAgentPage />} path="agents/:agentId/:section" />
        </Route>
      </Route>
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  )
}
