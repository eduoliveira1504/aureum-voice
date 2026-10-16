import { useEffect, useState, type ReactNode } from 'react'

import { ChannelSidebar, UserPanel } from '../components/ChannelSidebar'
import { ChatView } from '../components/ChatView'
import { MemberList } from '../components/MemberList'
import { AddServerModal } from '../components/modals'
import { ServerBar } from '../components/ServerBar'
import type { Channel, Me } from '../lib/api'
import { Realtime } from '../lib/realtime'
import { defaultChannel, useChat } from '../store/chat'

/** App shell: server bar | channel list | content | members. */
export function HomeScreen({ user }: { user: Me }): ReactNode {
  const server = useChat((s) => (s.selectedServerId ? s.servers[s.selectedServerId] : undefined))
  const selectedChannelId = useChat((s) => (server ? s.selectedChannelByServer[server.id] : undefined))
  const loaded = useChat((s) => s.loaded)
  const status = useChat((s) => s.status)

  // One real-time connection for the whole signed-in session.
  useEffect(() => {
    const chat = useChat.getState()
    chat.reset(user.id)
    const realtime = new Realtime(
      (event) => useChat.getState().applyEvent(event),
      (s) => useChat.getState().setStatus(s)
    )
    realtime.start()
    chat.loadServers().catch(() => {}) // also loaded on 'ready'; this covers a slow/failed socket
    return () => realtime.stop()
  }, [user.id])

  const channel = server && (server.channels.find((c) => c.id === selectedChannelId) ?? defaultChannel(server))
  const myRole = server?.members.find((m) => m.user.id === user.id)?.role

  return (
    <div className="flex h-full flex-col">
      {loaded && status !== 'online' && (
        <div className="shrink-0 bg-accent py-1 text-center text-sm font-medium text-accent-fg">
          Conexão perdida. Reconectando…
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ServerBar />
        {server ? (
          <>
            <ChannelSidebar server={server} selectedChannelId={channel?.id} me={user} />
            <Content channel={channel} me={user} canModerate={myRole === 'owner' || myRole === 'admin'} />
            <MemberList server={server} />
          </>
        ) : (
          <>
            <aside className="flex w-60 shrink-0 flex-col bg-surface-1">
              <div className="flex-1" />
              <UserPanel user={user} />
            </aside>
            {loaded ? <NoServers /> : <div className="flex-1 bg-surface-2" />}
          </>
        )}
      </div>
    </div>
  )
}

function Content({ channel, me, canModerate }: { channel?: Channel; me: Me; canModerate: boolean }): ReactNode {
  if (!channel) {
    return <Placeholder title="Nenhum canal" text="Crie um canal pelo menu do servidor." />
  }
  if (channel.type === 'text') return <ChatView channel={channel} me={me} canModerate={canModerate} />
  return <Placeholder title={`🔊 ${channel.name}`} text="Canais de voz chegam na próxima etapa (voz, câmera e tela)." />
}

function Placeholder({ title, text }: { title: string; text: string }): ReactNode {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-surface-2 p-8 text-center">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-fg-muted">{text}</p>
    </main>
  )
}

function NoServers(): ReactNode {
  const [adding, setAdding] = useState(false)
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-surface-2 p-8 text-center">
      <h2 className="text-2xl font-semibold">Você ainda não está em nenhum servidor</h2>
      <p className="mt-2 max-w-md text-fg-muted">Crie um servidor pro seu grupo ou entre com um código de convite.</p>
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-6 rounded-[3px] bg-accent px-6 py-2.5 font-semibold text-accent-fg hover:bg-accent-hover"
      >
        Criar ou entrar em um servidor
      </button>
      {adding && <AddServerModal onClose={() => setAdding(false)} />}
    </main>
  )
}
