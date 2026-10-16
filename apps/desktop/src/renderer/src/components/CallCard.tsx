import { HeadphoneOff, Headphones, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, PictureInPicture2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import type { User } from '../lib/api'
import { useChat } from '../store/chat'
import { useCallOnScreen, useNav } from '../store/nav'
import { dmTitle, useSocial } from '../store/social'
import { useVoice } from '../store/voice'
import { ScreenShareModal } from './ScreenShareModal'

const PHASE_LABEL = { connecting: 'Conectando…', reconnecting: 'Reconectando…', connected: 'Na chamada' }

export interface CallContext {
  /** The room's name, or the conversation's for a private call. */
  room: string
  /** The server's name, or "Mensagem direta" / "Grupo". */
  place: string
  /** Everyone who can be in the call, by user id. */
  people: Map<string, User>
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
    () => new Map((server?.members ?? dm?.members ?? []).map((m) => [m.user.id, m.user])),
    [server?.members, dm?.members]
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
      speakingText,
      open: () => useNav.getState().expandCall(server.id)
    }
  }
  return {
    room: dmTitle(dm!, meId),
    place: dm!.type === 'dm' ? 'Mensagem direta' : 'Grupo',
    people,
    speakingText,
    open: () => {
      useNav.getState().setCallFullscreen(false)
      useNav.getState().openHome(channelId)
    }
  }
}

/** Mic, deafen, screen and leave buttons shared by the call card and the floating window. */
export function CallButtons({ size = 18, compact = false }: { size?: number; compact?: boolean }): ReactNode {
  const { muted, deafened, screen, phase, toggleMute, toggleDeafen, stopScreenShare, leave } = useVoice()
  const [picking, setPicking] = useState(false)
  const micOff = muted || deafened
  const button = 'rounded-item p-1.5 hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <>
      <button
        type="button"
        title={micOff ? 'Ativar microfone' : 'Silenciar'}
        aria-label={micOff ? 'Ativar microfone' : 'Silenciar'}
        onClick={toggleMute}
        className={`${button} ${micOff ? 'text-danger' : 'text-fg-muted hover:text-fg'}`}
      >
        {micOff ? <MicOff size={size} /> : <Mic size={size} />}
      </button>
      {!compact && (
        <button
          type="button"
          title={deafened ? 'Ativar áudio' : 'Desativar áudio'}
          aria-label={deafened ? 'Ativar áudio' : 'Desativar áudio'}
          onClick={toggleDeafen}
          className={`${button} ${deafened ? 'text-danger' : 'text-fg-muted hover:text-fg'}`}
        >
          {deafened ? <HeadphoneOff size={size} /> : <Headphones size={size} />}
        </button>
      )}
      {!compact && (
        <button
          type="button"
          title={screen ? 'Parar de compartilhar' : 'Compartilhar tela'}
          aria-label={screen ? 'Parar de compartilhar' : 'Compartilhar tela'}
          disabled={phase !== 'connected'}
          onClick={() => (screen ? void stopScreenShare() : setPicking(true))}
          className={`${button} ${screen ? 'text-accent-text' : 'text-fg-muted hover:text-fg'}`}
        >
          {screen ? <MonitorOff size={size} /> : <MonitorUp size={size} />}
        </button>
      )}
      <button
        type="button"
        title="Sair da sala"
        aria-label="Sair da sala"
        onClick={() => void leave()}
        className={`${button} text-danger hover:bg-danger hover:text-on-danger`}
      >
        <PhoneOff size={size} />
      </button>
      {picking && <ScreenShareModal onClose={() => setPicking(false)} />}
    </>
  )
}

/** Bottom of the sidebar while the floating call window is minimized. */
export function CallCard({ collapsed, meId }: { collapsed: boolean; meId: string }): ReactNode {
  const info = useCallContext(meId)
  const phase = useVoice((s) => s.phase)
  const minimized = useNav((s) => s.pipMinimized)
  const setMinimized = useNav((s) => s.setPipMinimized)
  const onScreen = useCallOnScreen()
  if (!info || !minimized || onScreen || phase === 'idle') return null

  const showPip = (
    <button
      type="button"
      title="Mostrar janelinha"
      aria-label="Mostrar janelinha"
      onClick={() => setMinimized(false)}
      className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
    >
      <PictureInPicture2 size={18} />
    </button>
  )

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-0.5 border-t border-line bg-rail/40 py-2">
        <span title={`${info.room} · ${info.place}`} className={`mb-1 h-2 w-2 rounded-full ${phase === 'connected' ? 'bg-success' : 'bg-idle'}`} />
        {showPip}
        <CallButtons compact />
      </div>
    )
  }

  return (
    <div className="border-t border-line bg-rail/40 px-2.5 py-2.5">
      <button
        type="button"
        title="Abrir a chamada"
        onClick={info.open}
        className="block w-full min-w-0 rounded-item px-1 text-left hover:bg-elevated/60"
      >
        <span className={`block text-sm font-semibold ${phase === 'connected' ? 'text-success' : 'text-accent-text'}`}>
          {PHASE_LABEL[phase]} · {info.room}
        </span>
        <span className="block truncate text-xs text-fg-subtle">{info.speakingText}</span>
      </button>
      <div className="mt-1.5 flex items-center justify-between">
        <CallButtons />
        {showPip}
      </div>
    </div>
  )
}
