import type { Track } from 'livekit-client'
import {
  AudioWaveform,
  Expand,
  Eye,
  EyeOff,
  Headphones,
  HeadphoneOff,
  LayoutGrid,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
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
import { loadMediaPrefs } from '../lib/mediaPrefs'
import { serverPeople } from '../lib/members'
import { channelPermissions, has, Perm } from '../lib/permissions'
import { pttKeyLabel } from '../lib/pushToTalk'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { cameraTrackOf, getRoom, isSharing, micEnabled, roomIdentities, screenAudioOf, screenTrackOf, useVoice } from '../store/voice'
import { NameMarks } from './Badge'
import { CallPopover, DeviceArrow } from './CallDeviceMenus'
import { StatusBubble } from './profileBits'
import { ScreenShareModal } from './ScreenShareModal'
import { SoundboardGrid, SoundboardPrefs } from './Soundboard'
import { Avatar } from './ui'
import { LocallyMuted, userContextMenu } from './UserMenu'

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
  const screens = ids.filter((id) => isSharing(id)).map((id): Tile => ({ key: `${id}:screen`, identity: id, kind: 'screen' }))
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
  const people = useMemo(() => serverPeople(server), [server])
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
      {/* In fullscreen the header sits under Windows' window buttons: keep their width free. */}
      <header className={`flex h-12 shrink-0 items-center gap-2 pl-4 ${fullscreen ? 'pr-window-controls' : 'pr-4'}`}>
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
          <CallControls fullscreen={fullscreen} />
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
  const micMuted = !micEnabled(identity)
  const camera = cameraTrackOf(identity)

  return (
    <TileFrame
      size={size}
      label={name}
      onClick={onClick}
      // Right click: volume, local mute and the rest of the person's menu.
      onContextMenu={user ? userContextMenu(user, meId, useVoice.getState().serverId) : undefined}
      ring={speaking}
    >
      {camera ? (
        <VideoTrackView track={camera} mirror={isLocal} fit={size === 'focus' ? 'contain' : 'cover'} />
      ) : (
        <Avatar name={name} url={user?.avatar_url} size={size === 'strip' ? 40 : size === 'focus' ? 120 : 80} />
      )}
      {user && size !== 'strip' && (
        <div className="absolute bottom-10 left-2 flex max-w-[calc(100%-1rem)]">
          <StatusBubble user={user} tail="bottom-left" size="xs" />
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-item bg-scrim/60 px-2 py-0.5 text-sm text-on-scrim">
        {micMuted && <MicOff size={14} className="shrink-0 text-danger" />}
        {!isLocal && <LocallyMuted userId={identity} />}
        <span className="truncate">{name}</span>
        {user && <NameMarks user={user} />}
      </div>
    </TileFrame>
  )
}

/** Someone's shared screen: an invitation to watch it until "Assistir", then the stream. */
function ScreenTile(props: TileProps): ReactNode {
  const watching = useVoice((s) => s.watching.includes(props.identity))
  return props.isLocal || watching ? <ScreenView {...props} /> : <ScreenInvite {...props} />
}

function LiveBadge(): ReactNode {
  return <span className="shrink-0 rounded bg-danger px-1.5 text-[10px] font-bold leading-5 text-on-danger">AO VIVO</span>
}

/**
 * "Fulano está transmitindo" with "Assistir": nothing of the stream is received before the click.
 * Behind it, a blurred low-res frame of the screen (one every few seconds, without audio).
 */
function ScreenInvite({ identity, user, size, onClick }: TileProps): ReactNode {
  const watchScreen = useVoice((s) => s.watchScreen)
  const preview = useVoice((s) => s.screenPreviews[identity])
  const name = user?.display_name ?? 'Alguém'
  const small = size === 'strip'
  return (
    <TileFrame size={size} label={`Tela de ${name}`} onClick={onClick} dark>
      {preview && (
        <img src={preview} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-md" />
      )}
      <div className="absolute left-2 top-2">
        <LiveBadge />
      </div>
      <div className="relative flex max-w-full flex-col items-center gap-2 px-3 text-center text-on-scrim">
        <p className={`max-w-full truncate ${small ? 'text-xs' : 'text-sm'}`}>{name} está transmitindo</p>
        <button
          type="button"
          onClick={(e) => {
            // Watching also brings the stream into focus.
            e.stopPropagation()
            watchScreen(identity)
            onClick?.()
          }}
          className={`flex items-center gap-2 rounded-control bg-accent font-semibold text-on-accent hover:bg-accent-hover ${
            small ? 'px-2.5 py-1 text-xs' : 'px-4 py-2'
          }`}
        >
          <Eye size={small ? 14 : 18} />
          Assistir
        </button>
      </div>
    </TileFrame>
  )
}

function ScreenView({ identity, user, isLocal, size, onClick }: TileProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const track = screenTrackOf(identity)
  const audio = isLocal ? undefined : screenAudioOf(identity)
  const volume = useVoice((s) => s.screenVolume[identity] ?? 1)
  const setVolume = useVoice((s) => s.setScreenVolume)
  const stopWatching = useVoice((s) => s.stopWatching)
  const watchers = useVoice((s) => (isLocal ? s.watchers.length : 0))
  const name = isLocal ? 'Sua tela' : `Tela de ${user?.display_name ?? 'alguém'}`

  const fullscreen = useFullscreen(ref)
  const idle = useIdle(fullscreen, CONTROLS_IDLE_MS)

  // Just clicked "Assistir": the stream is on its way.
  if (!track) {
    return (
      <TileFrame size={size} label={name} onClick={onClick} dark>
        <span className="text-sm text-on-scrim">Abrindo transmissão…</span>
      </TileFrame>
    )
  }
  // Controls must not also put the tile in focus.
  const stop = (e: { stopPropagation(): void }): void => e.stopPropagation()
  const toggleFullscreen = (): void => {
    if (fullscreen) void document.exitFullscreen()
    else void ref.current?.requestFullscreen()
  }
  // In fullscreen the controls show while the mouse moves and hide with the cursor after it stops;
  // in the tile, they show on hover.
  const controlsShown = fullscreen
    ? idle
      ? 'pointer-events-none opacity-0'
      : 'opacity-100'
    : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'

  return (
    <TileFrame size={size} label={name} onClick={onClick} dark>
      {/* The whole box goes fullscreen, so its labels and controls come along. */}
      <div ref={ref} className={`relative flex h-full w-full items-center justify-center bg-scrim ${fullscreen && idle ? 'cursor-none' : ''}`}>
        <div className="flex h-full w-full items-center justify-center" onDoubleClick={size === 'strip' ? undefined : toggleFullscreen}>
          <VideoTrackView track={track} mirror={false} fit="contain" />
        </div>
        <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5">
          <LiveBadge />
          <span className={`truncate rounded-item bg-scrim/60 px-2 py-0.5 text-on-scrim ${size === 'strip' ? 'text-xs' : 'text-sm'}`}>{name}</span>
          {isLocal && (
            <span
              title="Quem clicou em Assistir"
              className={`flex shrink-0 items-center gap-1 rounded-item bg-scrim/60 px-2 py-0.5 text-on-scrim ${size === 'strip' ? 'text-xs' : 'text-sm'}`}
            >
              <Eye size={14} />
              {watchers} assistindo
            </span>
          )}
        </div>
        {fullscreen && (
          <button
            type="button"
            aria-label="Sair da tela cheia"
            title="Sair da tela cheia (Esc)"
            onClick={(e) => {
              stop(e)
              void document.exitFullscreen()
            }}
            onDoubleClick={stop}
            className={`absolute right-2 top-2 rounded-item bg-scrim/70 p-1.5 text-on-scrim transition-opacity hover:bg-scrim ${controlsShown}`}
          >
            <Minimize2 size={18} />
          </button>
        )}
        {size !== 'strip' && (audio || !fullscreen || !isLocal) && (
          <div
            onClick={stop}
            onKeyDown={stop}
            onDoubleClick={stop}
            className={`absolute bottom-2 right-2 flex items-center gap-2 rounded-item bg-scrim/70 px-2 py-1 text-on-scrim transition-opacity ${controlsShown}`}
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
            {!fullscreen && (
              <button type="button" aria-label="Tela cheia" title="Tela cheia" onClick={toggleFullscreen}>
                <Maximize2 size={18} />
              </button>
            )}
            {!isLocal && (
              <button
                type="button"
                aria-label="Parar de assistir"
                title="Parar de assistir"
                onClick={() => {
                  if (fullscreen) void document.exitFullscreen()
                  stopWatching(identity)
                }}
              >
                <EyeOff size={18} />
              </button>
            )}
          </div>
        )}
      </div>
    </TileFrame>
  )
}

const CONTROLS_IDLE_MS = 2000

/** Whether `ref`'s element is the document's fullscreen element right now. */
function useFullscreen(ref: { current: HTMLElement | null }): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const sync = (): void => setOn(document.fullscreenElement !== null && document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [ref])
  return on
}

/** While `watching`: true once the mouse has been still for `ms`, false again when it moves. */
export function useIdle(watching: boolean, ms: number): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    setIdle(false)
    if (!watching) return
    let timer = setTimeout(() => setIdle(true), ms)
    const wake = (): void => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), ms)
    }
    window.addEventListener('mousemove', wake)
    window.addEventListener('mousedown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('mousedown', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [watching, ms])
  return idle
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

/** Push-to-talk mode: which key opens the mic, lit while it's held. */
function PushToTalkHint(): ReactNode {
  const held = useVoice((s) => s.pttHeld)
  const muted = useVoice((s) => s.muted || s.deafened)
  useVoice((s) => s.version) // re-read the prefs when Settings changes the mode
  const { inputMode, pttKey } = loadMediaPrefs()
  if (inputMode !== 'ptt' || !pttKey) return null
  return (
    <p className={`pb-2 text-center text-xs font-medium ${held && !muted ? 'text-accent-text' : 'text-fg-subtle'}`}>
      {muted ? 'Microfone silenciado' : held ? 'Falando…' : `Segure ${pttKeyLabel(pttKey)} para falar`}
    </p>
  )
}

/** "Painel de sons", in server rooms only: opens the grid of the server's sounds. Off without
 * Falar and Usar o painel de sons in the room, while deafened, and when muted by the server. */
function SoundboardControl({ onOpenChange }: { onOpenChange(open: boolean): void }): ReactNode {
  const serverId = useVoice((s) => s.serverId)
  const channelId = useVoice((s) => s.channelId)
  const deafened = useVoice((s) => s.deafened || s.serverDeafened)
  const serverMuted = useVoice((s) => s.serverMuted)
  const connected = useVoice((s) => s.phase === 'connected')
  const server = useChat((s) => (serverId ? s.servers[serverId] : undefined))
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const toggle = (next: boolean): void => {
    setOpen(next)
    onOpenChange(next)
  }
  const blocked = deafened || serverMuted
  useEffect(() => {
    if (blocked && open) toggle(false)
  }, [blocked])
  if (!serverId || !server) return null
  const me = getRoom()?.localParticipant.identity ?? ''
  const channel = server.channels.find((c) => c.id === channelId)
  const perms = channel ? channelPermissions(server, channel, me) : 0
  const allowed = has(perms, Perm.SPEAK) && has(perms, Perm.USE_SOUNDBOARD)
  const label = !allowed
    ? 'Sem permissão para o painel de sons aqui'
    : deafened
      ? 'Painel de sons desligado com o áudio desativado'
      : serverMuted
        ? 'Você foi silenciado neste servidor'
        : 'Painel de sons'
  return (
    <span ref={anchor} className="flex">
      <ControlButton label={label} active={!open} disabled={!connected || !allowed || blocked} onClick={() => toggle(!open)}>
        <AudioWaveform size={22} />
      </ControlButton>
      {open && (
        <CallPopover anchor={anchor} label="Painel de sons" width={320} onClose={() => toggle(false)}>
          <SoundboardGrid serverId={serverId} canManage={has(perms, Perm.MANAGE_SOUNDBOARD)} />
          <SoundboardPrefs compact />
        </CallPopover>
      )}
    </span>
  )
}

/**
 * The call's control bar, at the bottom of the call, centered. The arrows next to the mic,
 * headphone and camera open their device menus. In fullscreen it fades out while the mouse stands
 * still, unless a menu is open, and its fullscreen button is the way out besides Esc.
 */
export function CallControls({ fullscreen = false }: { fullscreen?: boolean }): ReactNode {
  const { muted, deafened, camera, screen, phase, allowed, toggleMute, toggleDeafen, toggleCamera, stopScreenShare, leave } =
    useVoice()
  const [picking, setPicking] = useState(false)
  const [menus, setMenus] = useState(0)
  const setCallFullscreen = useNav((s) => s.setCallFullscreen)
  const idle = useIdle(fullscreen, CONTROLS_IDLE_MS)
  const hidden = fullscreen && idle && menus === 0 && !picking
  const menuOpen = (open: boolean): void => setMenus((n) => Math.max(0, n + (open ? 1 : -1)))
  const connecting = phase === 'connecting'
  return (
    <div className={`shrink-0 transition-opacity ${hidden ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
      <PushToTalkHint />
      <div role="toolbar" aria-label="Controles da chamada" className="flex items-center justify-center gap-3 pb-6">
        <div className="flex">
          <ControlButton
            label={!allowed.mic ? 'Sem permissão para falar aqui' : muted ? 'Ativar microfone' : 'Silenciar microfone'}
            active={!muted && allowed.mic}
            disabled={!allowed.mic}
            onClick={toggleMute}
          >
            {muted || !allowed.mic ? <MicOff size={22} /> : <Mic size={22} />}
          </ControlButton>
          <DeviceArrow kind="mic" onOpenChange={menuOpen} />
        </div>
        <div className="flex">
          <ControlButton label={deafened ? 'Ativar áudio' : 'Desativar áudio'} active={!deafened} onClick={toggleDeafen}>
            {deafened ? <HeadphoneOff size={22} /> : <Headphones size={22} />}
          </ControlButton>
          <DeviceArrow kind="output" onOpenChange={menuOpen} />
        </div>
        <div className="flex">
          <ControlButton
            label={!allowed.camera ? 'Sem permissão para câmera aqui' : camera ? 'Desligar câmera' : 'Ligar câmera'}
            active={!camera}
            disabled={connecting || (!camera && !allowed.camera)}
            onClick={toggleCamera}
          >
            {camera ? <Video size={22} /> : <VideoOff size={22} />}
          </ControlButton>
          <DeviceArrow kind="camera" onOpenChange={menuOpen} />
        </div>
        <ControlButton
          label={!allowed.screen ? 'Sem permissão para transmitir aqui' : screen ? 'Parar de compartilhar' : 'Compartilhar tela'}
          active={!screen}
          disabled={phase !== 'connected' || (!screen && !allowed.screen)}
          onClick={() => (screen ? void stopScreenShare() : setPicking(true))}
        >
          {screen ? <MonitorOff size={22} /> : <MonitorUp size={22} />}
        </ControlButton>
        <ControlButton label={fullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'} onClick={() => setCallFullscreen(!fullscreen)}>
          {fullscreen ? <Shrink size={22} /> : <Expand size={22} />}
        </ControlButton>
        <SoundboardControl onOpenChange={menuOpen} />
        <ControlButton label="Sair da chamada" danger onClick={() => void leave()}>
          <PhoneOff size={22} />
        </ControlButton>
        {picking && <ScreenShareModal onClose={() => setPicking(false)} />}
      </div>
    </div>
  )
}
