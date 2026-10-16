import type { Track } from 'livekit-client'
import { Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

import type { Channel, Member, ServerDetail } from '../lib/api'
import { cameraTrackOf, getRoom, roomIdentities, useVoice } from '../store/voice'
import { Avatar } from './ui'

/** Columns for n tiles: 1, 2, 2x2, 3x3, then 4 wide. */
function columns(n: number): number {
  if (n <= 1) return 1
  if (n <= 4) return 2
  if (n <= 9) return 3
  return 4
}

export function VoiceView({ server, channel, meId }: { server: ServerDetail; channel: Channel; meId: string }): ReactNode {
  const phase = useVoice((s) => s.phase)
  const activeChannelId = useVoice((s) => s.channelId)
  const join = useVoice((s) => s.join)
  useVoice((s) => s.version) // re-render on room changes

  const inThisChannel = activeChannelId === channel.id && phase !== 'idle'
  const members = new Map(server.members.map((m) => [m.user.id, m]))
  const present = server.voice_states.filter((v) => v.channel_id === channel.id)

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-black/90">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="text-fg-subtle">🔊</span>
        <h2 className="font-semibold">{channel.name}</h2>
        {phase === 'reconnecting' && inThisChannel && <span className="text-sm text-accent">Reconectando…</span>}
      </header>

      {inThisChannel ? (
        <>
          <ParticipantGrid members={members} meId={meId} connecting={phase === 'connecting'} />
          <CallControls />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <h3 className="text-2xl font-bold">{channel.name}</h3>
          <p className="text-fg-muted">
            {present.length === 0
              ? 'Ninguém está aqui ainda.'
              : `${present.map((v) => members.get(v.user_id)?.user.display_name ?? '…').join(', ')} ${present.length === 1 ? 'está' : 'estão'} no canal.`}
          </p>
          <button
            type="button"
            onClick={() => join(server.id, channel.id)}
            className="rounded-full bg-green-600 px-6 py-2.5 font-semibold text-white hover:bg-green-700"
          >
            Entrar no canal de voz
          </button>
        </div>
      )}
    </main>
  )
}

function ParticipantGrid({
  members,
  meId,
  connecting
}: {
  members: Map<string, Member>
  meId: string
  connecting: boolean
}): ReactNode {
  const speaking = useVoice((s) => s.speaking)
  const ids = connecting ? [meId] : roomIdentities()
  const cols = columns(ids.length)

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="grid w-full max-w-6xl gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {ids.map((id) => (
          <ParticipantTile
            key={id}
            identity={id}
            member={members.get(id)}
            isLocal={id === meId}
            speaking={speaking.includes(id)}
          />
        ))}
      </div>
    </div>
  )
}

function ParticipantTile({
  identity,
  member,
  isLocal,
  speaking
}: {
  identity: string
  member: Member | undefined
  isLocal: boolean
  speaking: boolean
}): ReactNode {
  const participant = isLocal ? getRoom()?.localParticipant : getRoom()?.remoteParticipants.get(identity)
  const name = member?.user.display_name ?? participant?.name ?? 'Alguém'
  const micMuted = !participant?.isMicrophoneEnabled
  const camera = cameraTrackOf(identity)

  return (
    <div
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-surface-1 transition-shadow ${
        speaking ? 'ring-[3px] ring-green-500' : 'ring-0'
      }`}
    >
      {camera ? (
        <VideoTrackView track={camera} mirror={isLocal} />
      ) : (
        <Avatar name={name} url={member?.user.avatar_url} size={80} />
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-sm">
        {micMuted && <MicOff size={14} className="text-danger" />}
        <span>{name}</span>
      </div>
    </div>
  )
}

function VideoTrackView({ track, mirror }: { track: Track; mirror: boolean }): ReactNode {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className="h-full w-full object-cover"
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  )
}

function ControlButton({
  label,
  active = true,
  danger = false,
  disabled = false,
  onClick,
  children
}: {
  label: string
  active?: boolean
  danger?: boolean
  disabled?: boolean
  onClick?(): void
  children: ReactNode
}): ReactNode {
  const color = danger
    ? 'bg-danger text-white hover:bg-danger/85'
    : active
      ? 'bg-surface-3 text-fg hover:bg-surface-3/70'
      : 'bg-fg text-surface-0 hover:bg-fg/85'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${color}`}
    >
      {children}
    </button>
  )
}

export function CallControls(): ReactNode {
  const { muted, deafened, camera, phase, toggleMute, toggleDeafen, toggleCamera, leave } = useVoice()
  const connecting = phase === 'connecting'
  return (
    <div className="flex shrink-0 justify-center gap-3 pb-6">
      <ControlButton label={muted ? 'Ativar microfone' : 'Silenciar microfone'} active={!muted} onClick={toggleMute}>
        {muted ? <MicOff size={22} /> : <Mic size={22} />}
      </ControlButton>
      <ControlButton label={deafened ? 'Ativar áudio' : 'Desativar áudio'} active={!deafened} onClick={toggleDeafen}>
        {deafened ? <HeadphoneOff size={22} /> : <Headphones size={22} />}
      </ControlButton>
      <ControlButton
        label={camera ? 'Desligar câmera' : 'Ligar câmera'}
        active={!camera}
        disabled={connecting}
        onClick={toggleCamera}
      >
        {camera ? <Video size={22} /> : <VideoOff size={22} />}
      </ControlButton>
      <ControlButton label="Compartilhar tela (em breve)" disabled>
        <MonitorUp size={22} />
      </ControlButton>
      <ControlButton label="Sair da chamada" danger onClick={leave}>
        <PhoneOff size={22} />
      </ControlButton>
    </div>
  )
}
