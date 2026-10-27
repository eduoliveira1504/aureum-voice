import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import * as client from '../lib/api'
import type { Me } from '../lib/api'
import { serverNotice } from '../lib/accountErrors'
import { clearAttachmentCache } from '../lib/attachments'

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; serverUnreachable?: boolean; serverMessage?: string }
  | { status: 'signedIn'; user: Me }

interface AuthContextValue {
  state: AuthState
  login(email: string, password: string): Promise<void>
  register(input: { username: string; email: string; password: string; display_name?: string; invite_code?: string }): Promise<void>
  logout(): Promise<void>
  setUser(user: Me): void
  /** Reads the account again (after a password change, a confirmed e-mail...). */
  reload(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const loadMe = useCallback(async () => {
    const user = await client.api<Me>('/users/me')
    setState({ status: 'signedIn', user })
  }, [])

  // Restore the previous session on startup.
  useEffect(() => {
    client.setSessionExpiredHandler(() => setState({ status: 'signedOut' }))
    ;(async () => {
      const settings = await window.aureum.settings.get()
      client.setApiBaseUrl(settings.apiUrl)
      try {
        if (await client.refreshSession()) {
          await loadMe()
        } else {
          setState({ status: 'signedOut' })
        }
      } catch (err) {
        // Network error or server out of service: keep the stored session, let the user retry
        // or change the server.
        setState({ status: 'signedOut', serverUnreachable: true, serverMessage: serverNotice(err) ?? undefined })
      }
    })()
  }, [loadMe])

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login: async (email, password) => {
        await client.login(email, password)
        await loadMe()
      },
      register: async (input) => {
        await client.register(input)
        await loadMe()
      },
      logout: async () => {
        await client.clearTokens()
        // Files from this account's conversations don't stay on the PC.
        await clearAttachmentCache()
        setState({ status: 'signedOut' })
      },
      setUser: (user) => setState({ status: 'signedIn', user }),
      reload: loadMe
    }),
    [state, loadMe]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
