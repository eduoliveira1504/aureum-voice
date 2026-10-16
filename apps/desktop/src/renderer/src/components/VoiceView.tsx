import type { Track } from 'livekit-client'
import {
  Headphones,
  HeadphoneOff,
  Maximize2,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { Channel, Member, ServerDetail } from '../lib/api'
import { cameraTrackOf, getRoom, roomIdentities, screenAudioOf, screenTrackOf, useVoice } from '../store/voice'
import { ScreenShareModal } from './ScreenShareModal'
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
    <main className="flex min-w-0 flex-1 flex-col bg-rail">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Volume2 size={20} className="text-fg-subtle" />
        <h2 className="font-semibold">{channel.name}</h2>
        {phase === 'reconnecting' && inThisChannel && <span className="text-sm text-accent-text">Reconectando…</span>}
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
            className="rounded-control bg-accent px-6 py-2.5 font-semibold text-on-accent hover:bg-accent-hover"
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
  const sharing = ids.filter((id) => screenTrackOf(id))
  const cols = columns(ids.length)
  const tile = (id: string, compact = false): ReactNode => (
    <ParticipantTile
      key={id}
      identity={id}
      member={members.get(id)}
      isLocal={id === meId}
      speaking={speaking.includes(id)}
      compact={compact}
    />
  )

  if (sharing.length > 0) {
    // Spotlight: shared screens take the stage, people move to a strip below.
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div
          className="grid min-h-0 flex-1 gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.min(sharing.length, 2)}, minmax(0, 1fr))` }}
        >
          {sharing.map((id) => (
            <ScreenTile key={id} identity={id} name={members.get(id)?.user.display_name ?? 'Alguém'} isLocal={id === meId} />
          ))}
        </div>
        <div className="flex shrink-0 justify-center gap-3 [&>*]:w-44">{ids.map((id) => tile(id, true))}</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="grid w-full max-w-6xl gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {ids.map((id) => tile(id))}
      </div>
    </div>
  )
}

function ParticipantTile({
  identity,
  member,
  isLocal,
  speaking,
  compact = false
}: {
  identity: string
  member: Member | undefined
  isLocal: boolean
  speaking: boolean
  /** Smaller avatar for the strip under a shared screen. */
  compact?: boolean
}): ReactNode {
  const participant = isLocal ? getRoom()?.localParticipant : getRoom()?.remoteParticipants.get(identity)
  const name = member?.user.display_name ?? participant?.name ?? 'Alguém'
  const micMuted = !participant?.isMicrophoneEnabled
  const camera = cameraTrackOf(identity)

  return (
    <div
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-control bg-panel transition-shadow ${
        speaking ? 'ring-[3px] ring-accent' : 'ring-0'
      }`}
    >
      {camera ? (
        <VideoTrackView track={camera} mirror={isLocal} />
      ) : (
        <Avatar name={name} url={member?.user.avatar_url} size={compact ? 40 : 80} />
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-item bg-scrim/60 px-2 py-0.5 text-sm text-on-scrim">
        {micMuted && <MicOff size={14} className="text-danger" />}
        <span>{name}</span>
      </div>
    </div>
  )
}

function ScreenTile({ identity, name, isLocal }: { identity: string; name: string; isLocal: boolean }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const track = screenTrackOf(identity)
  const audio = isLocal ? undefined : screenAudioOf(identity)
  const [volume, setVolume] = useState(1)

  useEffect(() => {
    audio?.setVolume(volume)
  }, [audio, volume])

  if (!track) return null
  return (
    <div ref={ref} className="group relative flex min-h-0 items-center justify-center overflow-hidden rounded-control bg-scrim">
      <VideoTrackView track={track} mirror={false} fit="contain" />
      <div className="absolute left-2 top-2 rounded-item bg-scrim/60 px-2 py-0.5 text-sm text-on-scrim">
        {isLocal ? 'Sua tela' : `Tela de ${name}`}
      </div>
      <div className="absolute bottom-2 right-2 hidden items-center gap-2 rounded-item bg-scrim/70 px-2 py-1 text-on-scrim group-hover:flex">
        {audio && (
          <>
            <button type="button" aria-label={volume === 0 ? 'Ativar som da tela' : 'Silenciar som da tela'} onClick={() => setVolume(volume === 0 ? 1 : 0)}>
              {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              aria-label="Volume da tela"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-24 accent-accent"
            />
          </>
        )}
        <button type="button" aria-label="Tela cheia" title="Tela cheia" onClick={() => void ref.current?.requestFullscreen()}>
          <Maximize2 size={18} />
        </button>
      </div>
    </div>
  )
}

function VideoTrackView({
  track,
  mirror,
  fit = 'cover'
}: {
  track: Track
  mirror: boolean
  fit?: 'cover' | 'contain'
}): ReactNode {
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
      className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
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
    ? 'bg-danger text-on-danger hover:bg-danger/85'
    : active
      ? 'bg-elevated text-fg hover:bg-line'
      : 'bg-fg text-rail hover:bg-fg/85'
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
  const { muted, deafened, camera, screen, phase, toggleMute, toggleDeafen, toggleCamera, stopScreenShare, leave } =
    useVoice()
  const [picking, setPicking] = useState(false)
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
      <ControlButton
        label={screen ? 'Parar de compartilhar' : 'Compartilhar tela'}
        active={!screen}
        disabled={phase !== 'connected'}
        onClick={() => (screen ? void stopScreenShare() : setPicking(true))}
      >
        {screen ? <MonitorOff size={22} /> : <MonitorUp size={22} />}
      </ControlButton>
      <ControlButton label="Sair da chamada" danger onClick={leave}>
        <PhoneOff size={22} />
      </ControlButton>
      {picking && <ScreenShareModal onClose={() => setPicking(false)} />}
    </div>
  )
}
