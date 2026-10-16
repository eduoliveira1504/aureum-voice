import type { ReactNode } from 'react'

import { useAuth } from './auth/AuthProvider'
import { AuthScreen } from './screens/AuthScreen'
import { HomeScreen } from './screens/HomeScreen'

export function App(): ReactNode {
  const { state } = useAuth()

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
      </div>
    )
  }
  if (state.status === 'signedOut') return <AuthScreen serverUnreachable={state.serverUnreachable} />
  return <HomeScreen user={state.user} />
}
