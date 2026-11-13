/** What the overlay's widgets draw, shared by the windows over the game and the previews in Settings. */
import { HeadphoneOff, MicOff } from 'lucide-react'
import type { ReactNode } from 'react'

import type { OverlaySize } from '../../../shared/types'
import type { OverlayNotification } from '../store/overlay'
import { Avatar, TileRing } from './ui'
import { t } from '../lib/i18n'

export const SCALE: Record<OverlaySize, number> = { small: 0.8, medium: 1, large: 1.3 }

export interface Person {
  id: string
  name: string
  avatarUrl: string | null | undefined
  speaking: boolean
  muted: boolean
  deafened: boolean
}

function StateIcons({ person }: { person: Person }): ReactNode {
  return (
    <>
      {person.muted && <MicOff size="1.1em" className="shrink-0 text-danger" aria-label={t('overlay.micOff')} />}
      {person.deafened && <HeadphoneOff size="1.1em" className="shrink-0 text-danger" aria-label={t('overlay.audioOff')} />}
    </>
  )
}

export function PersonRow({ person, scale }: { person: Person; scale: number }): ReactNode {
  return (
    <div className="flex max-w-full items-center gap-[0.5em] rounded-full bg-scrim/75 py-[0.25em] pl-[0.25em] pr-[0.85em] text-on-scrim shadow">
      {/* The padding holds the ring around the picture (letter avatars are the accent color too). */}
      <span className="relative shrink-0 rounded-full p-[3px]">
        <Avatar name={person.name} url={person.avatarUrl} size={Math.round(30 * scale)} />
        <TileRing on={person.speaking} />
      </span>
      <span className="min-w-0 truncate font-semibold">{person.name}</span>
      <StateIcons person={person} />
    </div>
  )
}

/** A notification's lines; with `hideContent`, a message is only who sent it. */
export function notificationText(n: Omit<OverlayNotification, 'id'>, hideContent: boolean): { title: string; body?: string } {
  const handle = n.username ? `@${n.username}` : n.name
  switch (n.kind) {
    case 'dm':
      return hideContent ? { title: t('overlay.notification.dmHidden', { handle }) } : { title: n.name, body: n.text }
    case 'mention':
      return hideContent
        ? { title: t('overlay.notification.mentionHidden', { handle }) }
        : { title: t('overlay.notification.mention', { name: n.name }), body: n.text }
    case 'call':
      return { title: n.name, body: t('overlay.notification.calling') }
    case 'joined':
      return { title: t('overlay.notification.joined', { name: n.name }) }
    case 'left':
      return { title: t('overlay.notification.left', { name: n.name }) }
  }
}

export function NotificationCard({
  notification,
  hideContent,
  scale
}: {
  notification: Omit<OverlayNotification, 'id'>
  hideContent: boolean
  scale: number
}): ReactNode {
  const { title, body } = notificationText(notification, hideContent)
  return (
    <div role="status" className="flex w-full items-center gap-[0.6em] rounded-control bg-scrim/85 px-[0.7em] py-[0.5em] text-on-scrim shadow">
      <Avatar name={notification.name} url={notification.avatarUrl} size={Math.round(30 * scale)} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{title}</p>
        {body && <p className="truncate text-[0.9em] opacity-85">{body}</p>}
      </div>
    </div>
  )
}

/** The cameras in `columns` columns of `tileWidth` px (see cameraLayout in shared/overlayWidgets.ts). */
export function CameraTiles({
  columns,
  tileWidth,
  gap,
  children
}: {
  columns: number
  tileWidth: number
  gap: number
  children: ReactNode
}): ReactNode {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, ${tileWidth}px)`, gap }}>
      {children}
    </div>
  )
}

/** The width the camera's text and picture are drawn for at 100%. */
const CAMERA_BASE_WIDTH = 176

/**
 * A camera tile, `width` px wide (16:9); without `children` (a sample) it shows the person's
 * picture instead of video. `more`: how many cameras are left out, shown on the last one.
 */
export function CameraCard({
  person,
  width,
  rounded = true,
  more = 0,
  children
}: {
  person: Person
  width: number
  rounded?: boolean
  more?: number
  children?: ReactNode
}): ReactNode {
  const scale = width / CAMERA_BASE_WIDTH
  return (
    <div
      className={`relative aspect-video shrink-0 overflow-hidden bg-scrim shadow ${rounded ? 'rounded-control' : ''}`}
      style={{ width, fontSize: 14 * Math.min(1.4, Math.max(0.7, scale)) }}
    >
      {children ?? (
        <span className="flex h-full items-center justify-center">
          <Avatar name={person.name} url={person.avatarUrl} size={Math.round(40 * scale)} />
        </span>
      )}
      <span className="absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded-item bg-scrim/70 px-1.5 text-[0.8em] text-on-scrim">
        <span className="truncate">{person.name}</span>
        <StateIcons person={person} />
      </span>
      {more > 0 && (
        <span
          aria-label={t('overlay.cameras.moreCameras', { count: more })}
          className="absolute right-1 top-1 rounded-item bg-scrim/80 px-1.5 text-[0.85em] font-semibold tabular-nums text-on-scrim"
        >
          +{more}
        </span>
      )}
      <TileRing on={person.speaking} />
    </div>
  )
}
