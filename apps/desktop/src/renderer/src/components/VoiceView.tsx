import type { Track } from 'livekit-client'
import {
  Expand,
  Headphones,
  HeadphoneOff,
  LayoutGrid,
  Maximize2,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Presentation,
  Shrink,
  Video,
  VideoOff,
  Volume2,
  VolumeX
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'

import type { Channel, ServerDetail, User, VoiceState } from '../lib/api'
import { useNav } from '../store/nav'
import { cameraTrackOf, getRoom, roomIdentities, screenAudioOf, screenTrackOf, useVoice } from '../store/voice'
import { contextMenu } from './ContextMenu'
import { ScreenShareModal } from './ScreenShareModal'
import { Avatar } from './ui'
import { LocallyMuted, UserMenu } from './UserMenu'

type Layout = 'grid' | 'focus'

/** One box on the call stage: a person (camera or avatar) or a shared screen. */
interface Tile {
  key: string
  identity: string
  kind: 'person' | 'screen'
}

/** Columns for n tiles: 1, 2, 2x2, 3x3, then 4 wide. */
function columns(n: number): number {
  if (n <= 1) return 1
  if (n <= 4) return 2
  if (n <= 9) return 3
  return 4
}

/** Shared screens first (they're what people came to watch), then everyone in the call. */
function callTiles(ids: string[]): Tile[] {
  const screens = ids.filter((id) => screenTrackOf(id)).map((id): Tile => ({ key: `${id}:screen`, identity: id, kind: 'screen' }))
  return [...screens, ...ids.map((id): Tile => ({ key: `${id}:person`, identity: id, kind: 'person' }))]
}

/** A server voice room, expanded (in a panel or fullscreen). */
export function VoiceView({
  server,
  channel,
  meId,
  fullscreen = false
}: {
  server: ServerDetail
  channel: Channel
  meId: string
  fullscreen?: boolean
}): ReactNode {
  const join = useVoice((s) => s.join)
  const people = useMemo(() => new Map(server.members.map((m) => [m.user.id, m.user])), [server.members])
  return (
    <CallView
      title={channel.name ?? ''}
      channelId={channel.id}
      people={people}
      present={server.voice_states.filter((v) => v.channel_id === channel.id)}
      joinLabel="Entrar no canal de voz"
      onJoin={() => join(server.id, channel.id)}
      meId={meId}
      fullscreen={fullscreen}
    />
  )
}

/** A call with Grid and Focus layouts: a server room or a private call (DM or group). */
export function CallView({
  title,
  channelId,
  people,
  present,
  joinLabel,
  onJoin,
  meId,
  fullscreen = false,
  footer
}: {
  title: string
  channelId: string
  /** Everyone who may show up in the call, by user id. */
  people: Map<string, User>
  /** Who is in it right now (from voice states), shown before joining. */
  present: VoiceState[]
  joinLabel: string
  onJoin(): void
  meId: string
  fullscreen?: boolean
  /** Extra line under the stage (who is still being rung, in private calls). */
  footer?: ReactNode
}): ReactNode {
  const setCallFullscreen = useNav((s) => s.setCallFullscreen)
  const phase = useVoice((s) => s.phase)
  const activeChannelId = useVoice((s) => s.channelId)
  useVoice((s) => s.version) // re-render on room changes
  // null = automatic: focus on a shared screen when there is one, grid otherwise.
  const [chosenLayout, setChosenLayout] = useState<Layout | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)

  const inThisChannel = activeChannelId === channelId && phase !== 'idle'

  const tiles = inThisChannel ? callTiles(phase === 'connecting' ? [meId] : roomIdentities()) : []
  const hasScreen = tiles.some((t) => t.kind === 'screen')
  const layout: Layout = tiles.length < 2 ? 'grid' : (chosenLayout ?? (hasScreen ? 'focus' : 'grid'))
  // Without a pin (or when the pinned tile went away): someone else's screen, else someone else.
  // Our own screen is never picked automatically; watching yourself share isn't useful.
  const others = tiles.filter((t) => t.identity !== meId)
  const focused =
    tiles.find((t) => t.key === pinned) ?? others.find((t) => t.kind === 'screen') ?? others[0] ?? tiles[0]

  const focusOn = (key: string): void => {
    setPinned(key)
    setChosenLayout('focus')
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-rail">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Volume2 size={20} className="text-fg-subtle" />
        <h2 className="truncate font-semibold">{title}</h2>
        {phase === 'reconnecting' && inThisChannel && <span className="text-sm text-accent-text">Reconectando…</span>}
        {tiles.length > 1 && (
          <button
            type="button"
            onClick={() => setChosenLayout(layout === 'focus' ? 'grid' : 'focus')}
            className="ml-auto flex items-center gap-2 rounded-control border border-line bg-panel px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg"
          >
            {layout === 'focus' ? <LayoutGrid size={16} /> : <Presentation size={16} />}
            {layout === 'focus' ? 'Grade' : 'Foco'}
          </button>
        )}
        {inThisChannel && (
          <button
            type="button"
            title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            onClick={() => setCallFullscreen(!fullscreen)}
            className={`${tiles.length > 1 ? '' : 'ml-auto'} rounded-control border border-line bg-panel p-1.5 text-fg-muted hover:bg-elevated hover:text-fg`}
          >
            {fullscreen ? <Shrink size={18} /> : <Expand size={18} />}
          </button>
        )}
      </header>

      {inThisChannel ? (
        <>
          <CallStage tiles={tiles} layout={layout} focused={focused} people={people} meId={meId} onFocus={focusOn} />
          {footer}
          <CallControls />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <h3 className="text-2xl font-bold">{title}</h3>
          <p className="text-fg-muted">
            {present.length === 0
              ? 'Ninguém está aqui ainda.'
              : `${present.map((v) => people.get(v.user_id)?.display_name ?? '…').join(', ')} ${present.length === 1 ? 'está' : 'estão'} aqui.`}
          </p>
          <button
            type="button"
            onClick={onJoin}
            className="rounded-control bg-accent px-6 py-2.5 font-semibold text-on-accent hover:bg-accent-hover"
          >
            {joinLabel}
          </button>
        </div>
      )}
    </div>
  )
}

function CallStage({
  tiles,
  layout,
  focused,
  people,
  meId,
  onFocus
}: {
  tiles: Tile[]
  layout: Layout
  focused: Tile | undefined
  people: Map<string, User>
  meId: string
  onFocus(key: string): void
}): ReactNode {
  const speaking = useVoice((s) => s.speaking)
  const render = (tile: Tile, size: TileSize): ReactNode => {
    const props = {
      identity: tile.identity,
      user: people.get(tile.identity),
      isLocal: tile.identity === meId,
      size,
      onClick: size === 'focus' ? undefined : () => onFocus(tile.key)
    }
    return tile.kind === 'screen' ? (
      <ScreenTile key={tile.key} {...props} />
    ) : (
      <ParticipantTile key={tile.key} {...props} speaking={speaking.includes(tile.identity)} meId={meId} />
    )
  }

  const cols = columns(tiles.length)
  const rows = Math.max(1, Math.ceil(tiles.length / cols))

  if (layout === 'focus' && focused) {
    // One big tile plus a scrolling strip. Strip tiles are small, so adaptiveStream asks for the
    // low layer, and the ones scrolled out of view get no video at all.
    return (
      <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4">
        <div className="flex min-w-0 flex-1">{render(focused, 'focus')}</div>
        <div className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
          {tiles.filter((t) => t.key !== focused.key).map((t) => render(t, 'strip'))}
        </div>
      </div>
    )
  }

  return (
    // The stage is a size container: the grid is capped so its 16:9 rows fit the height too
    // (otherwise one big tile in a wide window overflows and scrolls).
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4 [container-type:size]">
      <div
        className="grid w-full gap-3"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          maxWidth: `min(72rem, calc((100cqh - ${rows - 1} * 0.75rem) * 16 / 9 * ${cols} / ${rows}))`
        }}
      >
        {tiles.map((t) => render(t, 'grid'))}
      </div>
    </div>
  )
}

type TileSize = 'grid' | 'focus' | 'strip'

interface TileProps {
  identity: string
  user: User | undefined
  isLocal: boolean
  size: TileSize
  /** Puts the tile in focus; absent for the tile already in focus. */
  onClick?: () => void
}

/** Clickable frame shared by both tile kinds. */
function TileFrame({
  size,
  label,
  onClick,
  onContextMenu,
  ring = false,
  dark = false,
  children
}: {
  size: TileSize
  label: string
  onClick?: () => void
  onContextMenu?: (e: MouseEvent) => void
  ring?: boolean
  dark?: boolean
  children: ReactNode
}): ReactNode {
  const shape = size === 'focus' ? 'h-full w-full' : 'aspect-video w-full shrink-0'
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Colocar ${label} em foco` : label}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => onClick && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
      className={`group relative flex items-center justify-center overflow-hidden rounded-control transition-shadow ${shape} ${
        dark ? 'bg-scrim' : 'bg-panel'
      } ${ring ? 'ring-[3px] ring-accent' : 'ring-0'} ${onClick ? 'cursor-pointer outline-none hover:ring-2 hover:ring-line focus-visible:ring-2 focus-visible:ring-accent' : ''}`}
    >
      {children}
    </div>
  )
}

function ParticipantTile({ identity, user, isLocal, size, onClick, speaking, meId }: TileProps & { speaking: boolean; meId: string }): ReactNode {
  const participant = isLocal ? getRoom()?.localParticipant : getRoom()?.remoteParticipants.get(identity)
  const name = user?.display_name ?? participant?.name ?? 'Alguém'
  const micMuted = !participant?.isMicrophoneEnabled
  const camera = cameraTrackOf(identity)

  return (
    <TileFrame
      size={size}
      label={name}
      onClick={onClick}
      // Right click: volume, local mute and the rest of the person's menu.
      onContextMenu={user ? contextMenu(() => <UserMenu user={user} meId={meId} />) : undefined}
      ring={speaking}
    >
      {camera ? (
        <VideoTrackView track={camera} mirror={isLocal} fit={size === 'focus' ? 'contain' : 'cover'} />
      ) : (
        <Avatar name={name} url={user?.avatar_url} size={size === 'strip' ? 40 : size === 'focus' ? 120 : 80} />
      )}
      <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-item bg-scrim/60 px-2 py-0.5 text-sm text-on-scrim">
        {micMuted && <MicOff size={14} className="shrink-0 text-danger" />}
        {!isLocal && <LocallyMuted userId={identity} />}
        <span className="truncate">{name}</span>
      </div>
    </TileFrame>
  )
}

function ScreenTile({ identity, user, isLocal, size, onClick }: TileProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const track = screenTrackOf(identity)
  const audio = isLocal ? undefined : screenAudioOf(identity)
  const volume = useVoice((s) => s.screenVolume[identity] ?? 1)
  const setVolume = useVoice((s) => s.setScreenVolume)
  const name = isLocal ? 'Sua tela' : `Tela de ${user?.display_name ?? 'alguém'}`

  if (!track) return null
  // Controls must not also put the tile in focus.
  const stop = (e: { stopPropagation(): void }): void => e.stopPropagation()

  return (
    <TileFrame size={size} label={name} onClick={onClick} dark>
      <div ref={ref} className="flex h-full w-full items-center justify-center bg-scrim">
        <VideoTrackView track={track} mirror={false} fit="contain" />
      </div>
      <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5">
        <span className="shrink-0 rounded bg-danger px-1.5 text-[10px] font-bold leading-5 text-on-danger">AO VIVO</span>
        <span className={`truncate rounded-item bg-scrim/60 px-2 py-0.5 text-on-scrim ${size === 'strip' ? 'text-xs' : 'text-sm'}`}>{name}</span>
      </div>
      {size !== 'strip' && (
        <div
          onClick={stop}
          onKeyDown={stop}
          className="absolute bottom-2 right-2 flex items-center gap-2 rounded-item bg-scrim/70 px-2 py-1 text-on-scrim opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
        >
          {audio && (
            <>
              <button
                type="button"
                title={volume === 0 ? 'Ativar som da transmissão' : 'Silenciar transmissão'}
                aria-label={volume === 0 ? 'Ativar som da transmissão' : 'Silenciar transmissão'}
                onClick={() => setVolume(identity, volume === 0 ? 1 : 0)}
              >
                {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                aria-label="Volume da transmissão"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => setVolume(identity, Number(e.target.value))}
                className="w-24 accent-accent"
              />
            </>
          )}
          <button type="button" aria-label="Tela cheia" title="Tela cheia" onClick={() => void ref.current?.requestFullscreen()}>
            <Maximize2 size={18} />
          </button>
        </div>
      )}
    </TileFrame>
  )
}

export function VideoTrackView({
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
  const { muted, deafened, camera, screen, phase, allowed, toggleMute, toggleDeafen, toggleCamera, stopScreenShare, leave } =
    useVoice()
  const [picking, setPicking] = useState(false)
  const connecting = phase === 'connecting'
  return (
    <div className="flex shrink-0 justify-center gap-3 pb-6">
      <ControlButton
        label={!allowed.mic ? 'Sem permissão para falar aqui' : muted ? 'Ativar microfone' : 'Silenciar microfone'}
        active={!muted && allowed.mic}
        disabled={!allowed.mic}
        onClick={toggleMute}
      >
        {muted || !allowed.mic ? <MicOff size={22} /> : <Mic size={22} />}
      </ControlButton>
      <ControlButton label={deafened ? 'Ativar áudio' : 'Desativar áudio'} active={!deafened} onClick={toggleDeafen}>
        {deafened ? <HeadphoneOff size={22} /> : <Headphones size={22} />}
      </ControlButton>
      <ControlButton
        label={!allowed.camera ? 'Sem permissão para câmera aqui' : camera ? 'Desligar câmera' : 'Ligar câmera'}
        active={!camera}
        disabled={connecting || (!camera && !allowed.camera)}
        onClick={toggleCamera}
      >
        {camera ? <Video size={22} /> : <VideoOff size={22} />}
      </ControlButton>
      <ControlButton
        label={!allowed.screen ? 'Sem permissão para transmitir aqui' : screen ? 'Parar de compartilhar' : 'Compartilhar tela'}
        active={!screen}
        disabled={phase !== 'connected' || (!screen && !allowed.screen)}
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
