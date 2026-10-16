import './main.css'
import './store/appearance' // applies the cached theme before the first render

import { LucideProvider } from 'lucide-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LucideProvider strokeWidth={1.8}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </LucideProvider>
  </StrictMode>
)
