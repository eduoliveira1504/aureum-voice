/**
 * Keeps the Windows tray menu in step with the app (mic, deafen, status) and runs what it asks.
 * Runs while signed in; signed out, the menu only opens or quits the app.
 */

import type { TrayState } from '../../../shared/types'
import { useAppearance } from '../store/appearance'
import { useVoice } from '../store/voice'

function report(): void {
  const { muted, deafened } = useVoice.getState()
  const state: TrayState = { signedIn: true, muted, deafened, status: useAppearance.getState().settings.status }
  void window.aureum.tray.setState(state).catch(() => {})
}

export function startTrayBridge(): () => void {
  report()
  const stopVoice = useVoice.subscribe((s, prev) => {
    if (s.muted !== prev.muted || s.deafened !== prev.deafened) report()
  })
  const stopAppearance = useAppearance.subscribe((s, prev) => {
    if (s.settings.status !== prev.settings.status) report()
  })
  const stopCommands = window.aureum.tray.onCommand((command) => {
    if (command.type === 'mute') void useVoice.getState().toggleMute()
    else if (command.type === 'deafen') useVoice.getState().toggleDeafen()
    else useAppearance.getState().update({ status: command.status })
  })
  return () => {
    stopVoice()
    stopAppearance()
    stopCommands()
    void window.aureum.tray.setState({ signedIn: false, muted: false, deafened: false, status: 'online' }).catch(() => {})
  }
}
