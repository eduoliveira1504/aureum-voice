import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from './auth/AuthProvider'
import { DeletionScheduledScreen, ForcePasswordScreen, VerifyEmailScreen, VerifyReminder } from './components/AccountScreens'
import { AuthScreen } from './screens/AuthScreen'
import { AppShell } from './screens/AppShell'

/** Without the top bar (sign-in, loading), the top edge still moves the window. */
function WindowDragStrip(): ReactNode {
  return <div aria-hidden className="app-drag fixed inset-x-0 top-0 z-raised h-12" />
}

export function App(): ReactNode {
  // Changing the language re-renders the whole app from here, so t() called while rendering
  // (lib/i18n) is always in the current language, in any component.
  useTranslation()
  const { state } = useAuth()
  // "Agora não" on the confirmation screen: into the app, with a reminder to come back.
  const [verifyLater, setVerifyLater] = useState(false)

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <WindowDragStrip />
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
      </div>
    )
  }
  if (state.status === 'signedOut') {
    return (
      <>
        <WindowDragStrip />
        <AuthScreen serverUnreachable={state.serverUnreachable} serverMessage={state.serverMessage} />
      </>
    )
  }
  const { user } = state
  if (user.must_change_password) {
    return (
      <>
        <WindowDragStrip />
        <ForcePasswordScreen />
      </>
    )
  }
  if (user.deletion_due_at) {
    return (
      <>
        <WindowDragStrip />
        <DeletionScheduledScreen dueAt={user.deletion_due_at} />
      </>
    )
  }
  if (!user.email_verified && !verifyLater) {
    return (
      <>
        <WindowDragStrip />
        <VerifyEmailScreen user={user} onLater={() => setVerifyLater(true)} />
      </>
    )
  }
  return (
    <>
      <AppShell user={user} />
      {!user.email_verified && <VerifyReminder onOpen={() => setVerifyLater(false)} />}
    </>
  )
}
