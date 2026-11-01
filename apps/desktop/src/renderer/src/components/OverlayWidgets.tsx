/** What the overlay's widgets draw, shared by the windows over the game and the previews in Settings. */
import { HeadphoneOff, MicOff } from 'lucide-react'
import type { ReactNode } from 'react'

import type { OverlayCameraLayout, OverlaySize } from '../../../shared/types'
import { Avatar, TileRing } from './ui'

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
      {person.muted && <MicOff size="1.1em" className="shrink-0 text-danger" aria-label="Microfone desligado" />}
      {person.deafened && <HeadphoneOff size="1.1em" className="shrink-0 text-danger" aria-label="Áudio desligado" />}
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

/** The tiles in a row or a column, wrapping to the next one when the box runs out. */
export function CameraTiles({ layout, children }: { layout: OverlayCameraLayout; children: ReactNode }): ReactNode {
  return <div className={`flex flex-wrap gap-1.5 ${layout === 'horizontal' ? 'flex-row' : 'flex-col'}`}>{children}</div>
}

/** A camera tile; without `children` (a sample) it shows the person's picture instead of video. */
export function CameraCard({ person, scale, children }: { person: Person; scale: number; children?: ReactNode }): ReactNode {
  return (
    <div className="relative aspect-video max-w-full shrink-0 overflow-hidden rounded-control bg-scrim shadow" style={{ width: 176 * scale }}>
      {children ?? (
        <span className="flex h-full items-center justify-center">
          <Avatar name={person.name} url={person.avatarUrl} size={Math.round(40 * scale)} />
        </span>
      )}
      <span className="absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded-item bg-scrim/70 px-1.5 text-[0.8em] text-on-scrim">
        <span className="truncate">{person.name}</span>
        <StateIcons person={person} />
      </span>
      <TileRing on={person.speaking} />
    </div>
  )
}
