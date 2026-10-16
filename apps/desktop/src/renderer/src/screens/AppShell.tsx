import { useEffect, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { CallPip } from '../components/CallPip'
import { HomeView } from '../components/HomeView'
import { MemberList } from '../components/MemberList'
import { Panels } from '../components/Panels'
import { Sidebar } from '../components/Sidebar'
import { TopBar } from '../components/TopBar'
import { VoiceView } from '../components/VoiceView'
import type { Me } from '../lib/api'
import { Realtime, setActiveRealtime } from '../lib/realtime'
import { loadAppearance, useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
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
  const membersOpen = useNav((s) => s.membersOpen)
  const narrow = useNav((s) => s.narrow)
  const { setUser } = useAuth()

  // One real-time connection for the whole signed-in session.
  useEffect(() => {
    const chat = useChat.getState()
    chat.reset(user.id)
    useNav.setState({ place: 'home' }) // the app always opens on Home
    const realtime = new Realtime(
      (event) => {
        // Our own profile changed (maybe on another device): keep the signed-in user fresh.
        if (event.type === 'user.updated' && event.data.id === user.id) setUser({ ...user, ...event.data })
        if (event.type === 'settings.updated') useAppearance.getState().hydrate(event.data)
        if (event.type === 'screen.thumbnail') return applyThumbnail(event.data)
        if (event.type === 'ready') rewatchOverview()
        useChat.getState().applyEvent(event)
      },
      (s) => useChat.getState().setStatus(s)
    )
    setActiveRealtime(realtime)
    realtime.start()
    chat.loadServers().catch(() => {}) // also loaded on 'ready'; this covers a slow/failed socket
    loadAppearance().catch(() => {}) // keep the cached settings if this fails
    return () => {
      void useVoice.getState().leave()
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
        {server ? <Panels server={server} me={user} /> : <HomeView />}
        {server && membersOpen && (
          <div className={narrow ? 'absolute inset-y-0 right-0 z-20 shadow-2xl' : 'py-2 pr-2'}>
            <div className={`h-full overflow-hidden ${narrow ? 'border-l border-line' : 'rounded-panel border border-line'}`}>
              <MemberList server={server} onClose={() => useNav.getState().toggleMembers()} />
            </div>
          </div>
        )}
      </div>
      <CallPip meId={user.id} />
      <FullscreenCall meId={user.id} />
    </div>
  )
}

/** The call over the whole window; Esc goes back. */
function FullscreenCall({ meId }: { meId: string }): ReactNode {
  const on = useNav((s) => s.callFullscreen)
  const phase = useVoice((s) => s.phase)
  const serverId = useVoice((s) => s.serverId)
  const channelId = useVoice((s) => s.channelId)
  const server = useChat((s) => (serverId ? s.servers[serverId] : undefined))
  const channel = server?.channels.find((c) => c.id === channelId)
  const inCall = phase !== 'idle' && !!channel

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

  if (!on || !server || !channel) return null
  return (
    <div className="fixed inset-0 z-40 flex bg-rail">
      <VoiceView server={server} channel={channel} meId={meId} fullscreen />
    </div>
  )
}
