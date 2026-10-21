import { useEffect, useMemo, type ReactNode } from 'react'

import { dispatchAddonEvent } from '../addons/registry'
import { useAuth } from '../auth/AuthProvider'
import { CallPip } from '../components/CallPip'
import { ContextMenuHost } from '../components/ContextMenu'
import { IncomingCall, MissedCallNotice, useOutgoingCall } from '../components/CallRinging'
import { HomeView } from '../components/HomeView'
import { MemberList } from '../components/MemberList'
import { OverlayHost } from '../components/Overlay'
import { Panels } from '../components/Panels'
import { openReportProblem } from '../components/ReportProblem'
import { Sidebar } from '../components/Sidebar'
import { TopBar } from '../components/TopBar'
import { CallView, VoiceView } from '../components/VoiceView'
import type { Me } from '../lib/api'
import { reportActivityAgain, startActivityReporting } from '../lib/gameActivity'
import { reportIdleAgain, startIdleWatch } from '../lib/idle'
import { Realtime, setActiveRealtime } from '../lib/realtime'
import { startTrayBridge } from '../lib/tray'
import { useActivity } from '../store/activity'
import { loadAppearance, useAppearance } from '../store/appearance'
import { useBadges } from '../store/badges'
import { useChat } from '../store/chat'
import { layoutOf, membersOpenFor, useNav } from '../store/nav'
import { dmTitle, useSocial } from '../store/social'
import { applyThumbnail, rewatchOverview } from '../store/thumbnails'
import { useVoice } from '../store/voice'

// Below this width the sidebar shows icons only and a single panel fits.
const NARROW_QUERY = '(max-width: 1099px)'

/** App shell: top bar with tabs | sidebar of the current tab | panels, plus the floating call window. */
export function AppShell({ user }: { user: Me }): ReactNode {
  const place = useNav((s) => s.place)
  const server = useChat((s) => (place === 'home' ? undefined : s.servers[place]))
  const loaded = useChat((s) => s.loaded)
  const status = useChat((s) => s.status)
  const focusedPanel = useNav((s) => (server ? (s.focusedPanel[server.id] ?? 0) : 0))
  // Re-render when the server's panels change; the rest is read from the layout.
  useAppearance((s) => (server ? s.settings.panel_layouts[server.id] : undefined))
  const membersOpen = !!server && membersOpenFor(layoutOf(server.id), focusedPanel)
  const narrow = useNav((s) => s.narrow)
  const { setUser } = useAuth()
  useOutgoingCall(user.id)

  // Ctrl+Shift+R (caught by the main process, so it works over any screen).
  useEffect(() => window.aureum.app.onReportProblem(() => void openReportProblem()), [])

  // What each badge looks like (profiles only carry keys and numbers).
  useEffect(() => void useBadges.getState().load(), [user.id])

  // One real-time connection for the whole signed-in session.
  useEffect(() => {
    const chat = useChat.getState()
    chat.reset(user.id)
    useSocial.getState().reset(user.id)
    useNav.setState({ place: 'home', homePage: 'hub' }) // the app always opens on the Home hub
    const realtime = new Realtime(
      (event) => {
        // Our own profile changed (maybe on another device): keep the signed-in user fresh.
        if (event.type === 'user.updated' && event.data.id === user.id) setUser({ ...user, ...event.data })
        if (event.type === 'settings.updated') useAppearance.getState().hydrate(event.data)
        if (event.type === 'screen.thumbnail') return applyThumbnail(event.data)
        if (event.type === 'ready') {
          rewatchOverview()
          reportIdleAgain()
          reportActivityAgain()
        }
        dispatchAddonEvent(event)
        useActivity.getState().applyEvent(event)
        useChat.getState().applyEvent(event)
        useSocial.getState().applyEvent(event)
      },
      (s) => useChat.getState().setStatus(s)
    )
    setActiveRealtime(realtime)
    realtime.start()
    const stopIdleWatch = startIdleWatch()
    const stopActivity = startActivityReporting()
    const stopTray = startTrayBridge()
    chat.loadServers().catch(() => {}) // also loaded on 'ready'; this covers a slow/failed socket
    useSocial.getState().load().catch(() => {})
    loadAppearance().catch(() => {}) // keep the cached settings if this fails
    return () => {
      void useVoice.getState().leave(true)
      stopIdleWatch()
      stopActivity()
      stopTray()
      useActivity.setState({ byUser: {} })
      setActiveRealtime(null)
      realtime.stop()
    }
  }, [user.id])

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY)
    const apply = (): void => useNav.getState().setNarrow(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  // The open server was left or deleted: back to Home.
  useEffect(() => {
    if (loaded && place !== 'home' && !server) useNav.getState().go('home')
  }, [loaded, place, server])

  return (
    <div className="flex h-full flex-col">
      {loaded && status !== 'online' && (
        <div className="shrink-0 bg-accent py-1 text-center text-sm font-medium text-on-accent">
          Conexão perdida. Reconectando…
        </div>
      )}
      <TopBar me={user} />
      <div className="relative flex min-h-0 flex-1 bg-panel">
        <Sidebar server={server ?? null} me={user} />
        {server ? <Panels server={server} me={user} /> : <HomeView me={user} />}
        {server && membersOpen && (
          <div className={narrow ? 'absolute inset-y-0 right-0 z-20 shadow-2xl' : 'py-2 pr-2'}>
            <div className={`h-full overflow-hidden ${narrow ? 'border-l border-line' : 'rounded-panel border border-line'}`}>
              <MemberList server={server} meId={user.id} onClose={() => useNav.getState().toggleMembers(server.id)} />
            </div>
          </div>
        )}
      </div>
      <CallPip meId={user.id} />
      <OverlayHost me={user} />
      <FullscreenCall meId={user.id} />
      <IncomingCall meId={user.id} />
      <MissedCallNotice meId={user.id} />
      <ContextMenuHost />
    </div>
  )
}

/** The call over the whole window (a server room or a private call); Esc goes back. */
function FullscreenCall({ meId }: { meId: string }): ReactNode {
  const on = useNav((s) => s.callFullscreen)
  const phase = useVoice((s) => s.phase)
  const serverId = useVoice((s) => s.serverId)
  const channelId = useVoice((s) => s.channelId)
  const server = useChat((s) => (serverId ? s.servers[serverId] : undefined))
  const channel = server?.channels.find((c) => c.id === channelId)
  const dm = useSocial((s) => (!serverId && channelId ? s.dms[channelId] : undefined))
  const people = useMemo(() => new Map((dm?.members ?? []).map((m) => [m.user.id, m.user])), [dm?.members])
  const inCall = phase !== 'idle' && (!!channel || !!dm)

  useEffect(() => {
    if (on && !inCall) useNav.getState().setCallFullscreen(false)
  }, [on, inCall])

  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent): void => {
      // Modals (e.g. the screen picker) handle their own Escape.
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) useNav.getState().setCallFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [on])

  if (!on || !inCall) return null
  return (
    <div className="fixed inset-0 z-40 flex bg-rail">
      {server && channel ? (
        <VoiceView server={server} channel={channel} meId={meId} fullscreen />
      ) : (
        dm && (
          <CallView
            title={dmTitle(dm, meId)}
            channelId={dm.id}
            people={people}
            present={dm.voice_states}
            joinLabel="Entrar na chamada"
            onJoin={() => void useVoice.getState().join(null, dm.id)}
            meId={meId}
            fullscreen
          />
        )
      )}
    </div>
  )
}
