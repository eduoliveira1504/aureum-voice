import {
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  PictureInPicture2,
  Video,
  VideoOff
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import type { User, VoiceState } from '../lib/api'
import { serverPeople } from '../lib/members'
import { useChat } from '../store/chat'
import { useCallOnScreen, useNav } from '../store/nav'
import { dmTitle, useSocial } from '../store/social'
import { useVoice } from '../store/voice'
import { contextMenu } from './ContextMenu'
import { ScreenShareModal } from './ScreenShareModal'
import { Avatar } from './ui'
import { UserMenu } from './UserMenu'

const PHASE_LABEL = { connecting: 'Conectando…', reconnecting: 'Reconectando…', connected: 'Na chamada' }

export interface CallContext {
  /** The room's name, or the conversation's for a private call. */
  room: string
  /** The server's name, or "Mensagem direta" / "Grupo". */
  place: string
  /** Everyone who can be in the call, by user id (with server nicknames). */
  people: Map<string, User>
  /** Who is in the call now. */
  present: VoiceState[]
  speakingText: string
  /** Shows the call in full: in a panel of its server, or in its conversation. */
  open(): void
}

/** What the current call is about, for a server room or a private call alike. */
export function useCallContext(meId: string | null): CallContext | null {
  const phase = useVoice((s) => s.phase)
  const serverId = useVoice((s) => s.serverId)
  const channelId = useVoice((s) => s.channelId)
  const speaking = useVoice((s) => s.speaking)
  const server = useChat((s) => (serverId ? s.servers[serverId] : undefined))
  const dm = useSocial((s) => (!serverId && channelId ? s.dms[channelId] : undefined))
  const people = useMemo(
    () => (server ? serverPeople(server) : new Map((dm?.members ?? []).map((m) => [m.user.id, m.user]))),
    [server, dm?.members]
  )
  if (phase === 'idle' || !channelId || (!server && !dm)) return null
  const names = speaking.map((id) => people.get(id)?.display_name).filter(Boolean)
  const speakingText =
    names.length === 0 ? 'Ninguém falando' : names.length === 1 ? `${names[0]} está falando` : `${names.join(', ')} estão falando`
  if (server) {
    return {
      room: server.channels.find((c) => c.id === channelId)?.name ?? '',
      place: server.name,
      people,
      present: server.voice_states.filter((v) => v.channel_id === channelId),
      speakingText,
      open: () => useNav.getState().expandCall(server.id)
    }
  }
  return {
    room: dmTitle(dm!, meId),
    place: dm!.type === 'dm' ? 'Mensagem direta' : 'Grupo',
    people,
    present: dm!.voice_states,
    speakingText,
    open: () => {
      useNav.getState().setCallFullscreen(false)
      useNav.getState().openHome(channelId)
    }
  }
}

/** Mic, deafen, camera, screen and leave buttons shared by the call card and the floating window. */
export function CallButtons({ size = 18, compact = false }: { size?: number; compact?: boolean }): ReactNode {
  const { muted, deafened, camera, screen, phase, allowed, serverMuted, serverDeafened } = useVoice()
  const { toggleMute, toggleDeafen, toggleCamera, stopScreenShare, leave } = useVoice.getState()
  const [picking, setPicking] = useState(false)
  const micOff = muted || deafened || !allowed.mic
  const micLabel =
    serverMuted || serverDeafened
      ? 'Silenciado pelo servidor'
      : !allowed.mic
        ? 'Sem permissão para falar aqui'
        : micOff
          ? 'Ativar microfone'
          : 'Silenciar'
  const deafLabel = serverDeafened ? 'Áudio desativado pelo servidor' : deafened ? 'Ativar áudio' : 'Desativar áudio'
  const button = 'rounded-item p-1.5 hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40'
  const tone = (off: boolean): string => (off ? 'text-danger' : 'text-fg-muted hover:text-fg')
  return (
    <>
      <button type="button" title={micLabel} aria-label={micLabel} disabled={!allowed.mic} onClick={toggleMute} className={`${button} ${tone(micOff)}`}>
        {micOff ? <MicOff size={size} /> : <Mic size={size} />}
      </button>
      {!compact && (
        <button
          type="button"
          title={deafLabel}
          aria-label={deafLabel}
          disabled={serverDeafened}
          onClick={toggleDeafen}
          className={`${button} ${tone(deafened || serverDeafened)}`}
        >
          {deafened || serverDeafened ? <HeadphoneOff size={size} /> : <Headphones size={size} />}
        </button>
      )}
      {!compact && (
        <button
          type="button"
          title={!allowed.camera ? 'Sem permissão para câmera aqui' : camera ? 'Desligar câmera' : 'Ligar câmera'}
          aria-label={camera ? 'Desligar câmera' : 'Ligar câmera'}
          disabled={phase === 'connecting' || (!camera && !allowed.camera)}
          onClick={() => void toggleCamera()}
          className={`${button} ${camera ? 'text-accent-text' : 'text-fg-muted hover:text-fg'}`}
        >
          {camera ? <Video size={size} /> : <VideoOff size={size} />}
        </button>
      )}
      {!compact && (
        <button
          type="button"
          title={!allowed.screen ? 'Sem permissão para transmitir aqui' : screen ? 'Parar de compartilhar' : 'Compartilhar tela'}
          aria-label={screen ? 'Parar de compartilhar' : 'Compartilhar tela'}
          disabled={phase !== 'connected' || (!screen && !allowed.screen)}
          onClick={() => (screen ? void stopScreenShare() : setPicking(true))}
          className={`${button} ${screen ? 'text-accent-text' : 'text-fg-muted hover:text-fg'}`}
        >
          {screen ? <MonitorOff size={size} /> : <MonitorUp size={size} />}
        </button>
      )}
      <button
        type="button"
        title="Sair da chamada"
        aria-label="Sair da chamada"
        onClick={() => void leave()}
        className={`${button} text-danger hover:bg-danger hover:text-on-danger`}
      >
        <PhoneOff size={size} />
      </button>
      {picking && <ScreenShareModal onClose={() => setPicking(false)} />}
    </>
  )
}

const MAX_FACES = 7

/** Bottom of the sidebar for the whole call: where, who's in it and who's talking, and the controls. */
export function CallCard({ collapsed, meId }: { collapsed: boolean; meId: string }): ReactNode {
  const info = useCallContext(meId)
  const phase = useVoice((s) => s.phase)
  const speaking = useVoice((s) => s.speaking)
  const minimized = useNav((s) => s.pipMinimized)
  const setMinimized = useNav((s) => s.setPipMinimized)
  const onScreen = useCallOnScreen()
  if (!info || phase === 'idle') return null

  // The floating window is optional: shown or hidden from here (it hides itself while the call
  // is on screen anyway).
  const pipButton = !onScreen && (
    <button
      type="button"
      title={minimized ? 'Mostrar janelinha' : 'Esconder janelinha'}
      aria-label={minimized ? 'Mostrar janelinha' : 'Esconder janelinha'}
      aria-pressed={!minimized}
      onClick={() => setMinimized(!minimized)}
      className={`rounded-item p-1.5 hover:bg-elevated ${minimized ? 'text-fg-muted hover:text-fg' : 'text-accent-text'}`}
    >
      <PictureInPicture2 size={18} />
    </button>
  )
  const status = phase === 'connected' ? 'text-success' : 'text-accent-text'

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-0.5 border-t border-line bg-rail/40 py-2">
        <button type="button" title={`${info.room} · ${info.place}`} onClick={info.open} className="mb-1 p-1">
          <span className={`block h-2 w-2 rounded-full ${phase === 'connected' ? 'bg-success' : 'bg-idle'}`} />
        </button>
        {pipButton}
        <CallButtons compact />
      </div>
    )
  }

  const faces = info.present.slice(0, MAX_FACES)
  return (
    <section aria-label="Chamada atual" className="border-t border-line bg-rail/40 px-2.5 py-2.5">
      <div className="flex items-start gap-1">
        <button type="button" title="Abrir a chamada" onClick={info.open} className="min-w-0 flex-1 rounded-item px-1 text-left hover:bg-elevated/60">
          <span className={`block truncate text-sm font-semibold ${status}`}>
            {PHASE_LABEL[phase]} · {info.room}
          </span>
          <span className="block truncate text-xs text-fg-subtle">{info.place}</span>
        </button>
        {pipButton}
      </div>
      {faces.length > 0 && (
        <div className="mt-2 flex items-center gap-1 px-1">
          {faces.map((v) => {
            const user = info.people.get(v.user_id)
            return (
              <span
                key={v.user_id}
                title={user?.display_name}
                onContextMenu={user ? contextMenu(() => <UserMenu user={user} meId={meId} />) : undefined}
                className={`rounded-full ring-offset-1 ring-offset-panel ${speaking.includes(v.user_id) ? 'ring-2 ring-accent' : ''} ${v.muted ? 'opacity-60' : ''}`}
              >
                <Avatar name={user?.display_name ?? '?'} url={user?.avatar_url} size={24} />
              </span>
            )
          })}
          {info.present.length > MAX_FACES && <span className="text-xs font-semibold text-fg-muted">+{info.present.length - MAX_FACES}</span>}
        </div>
      )}
      <p className="mt-1 truncate px-1 text-xs text-fg-subtle">{info.speakingText}</p>
      <div className="mt-1.5 flex items-center justify-between">
        <CallButtons />
      </div>
    </section>
  )
}
