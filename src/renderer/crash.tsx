import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CrashApp } from './features/crash/crash-app.js'
import './styles/base.css'

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <CrashApp />
  </StrictMode>,
)
