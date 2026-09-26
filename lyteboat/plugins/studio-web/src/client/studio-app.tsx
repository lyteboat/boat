/**
 * The pages' routes under `/studio`: `/login` for everyone; the rest behind a
 * sign-in, inside the shell: the Dashboard, Users, System, and an agent's
 * workspace (`/agents/:agentId` opens its overview); and, beside the shell in
 * a frame of its own, the Evals surface (`/evals` opens the first agent's
 * runs, `/evals/:agentId` that agent's).
 * @module @lyteboat/studio-web/client/studio-app
 */

import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { StudioAgentPage } from './studio-agent-page.tsx'
import { useStudioAuth } from './studio-auth-context.tsx'
import { StudioDashboardPage } from './studio-dashboard-page.tsx'
import { StudioEvalsAgentScope } from './studio-evals-agent-scope.tsx'
import { StudioEvalsComparePage } from './studio-evals-compare-page.tsx'
import { StudioEvalsHome } from './studio-evals-home.tsx'
import { StudioEvalsRunDetail } from './studio-evals-run-detail.tsx'
import { StudioEvalsFirstAgentRedirect, StudioEvalsShell } from './studio-evals-shell.tsx'
import { StudioLoginPage } from './studio-login-page.tsx'
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
        <Route element={<StudioEvalsShell />} path="/evals">
          <Route element={<StudioEvalsFirstAgentRedirect />} index />
          <Route element={<StudioEvalsAgentScope />} path=":agentId">
            <Route element={<Navigate replace to="runs" />} index />
            <Route element={<StudioEvalsHome tab="cases" />} path="cases" />
            <Route element={<StudioEvalsHome tab="runs" />} path="runs" />
            <Route element={<StudioEvalsRunDetail />} path="runs/:runId" />
            <Route element={<StudioEvalsComparePage />} path="compare" />
          </Route>
        </Route>
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
