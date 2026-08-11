import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ShortcutsApp } from './features/shortcuts/shortcuts-app.js'
import { ErrorBoundary } from './ui/error-boundary.js'
import './styles/base.css'

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ShortcutsApp />
    </ErrorBoundary>
  </StrictMode>,
)
