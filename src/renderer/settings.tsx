import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsApp } from './features/settings/settings-app.js'
import { watchTheme } from './lib/theme.js'
import { ErrorBoundary } from './ui/error-boundary.js'
import './styles/base.css'

watchTheme()

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <SettingsApp />
    </ErrorBoundary>
  </StrictMode>,
)
