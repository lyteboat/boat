/**
 * The pages' entry: the router under `/studio`, the auth state, and the
 * confirmation modal around the route table, rendered into `#root`.
 * @module @lyteboat/studio-web/client/studio-main
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { StudioApp } from './studio-app.tsx'
import { StudioAuthProvider } from './studio-auth-context.tsx'
import { StudioConfirmProvider } from './studio-confirm-dialog.tsx'

const root = document.getElementById('root')
if (root === null) throw new Error('studio-web: the page has no #root element')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename="/studio">
      <StudioAuthProvider>
        <StudioConfirmProvider>
          <StudioApp />
        </StudioConfirmProvider>
      </StudioAuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
