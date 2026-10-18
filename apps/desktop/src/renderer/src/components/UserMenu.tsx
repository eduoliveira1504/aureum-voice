import { VolumeX } from 'lucide-react'
import type { ReactNode } from 'react'

import type { User } from '../lib/api'
import { useAppearance } from '../store/appearance'
import { getRoom, setUserAudio, useVoice } from '../store/voice'
import { CheckItem, Label, SliderItem } from './ContextMenu'

/** Right-click menu of a person: what the signed-in user can do with them. */
export function UserMenu({ user, meId }: { user: User; meId: string }): ReactNode {
  const audio = useAppearance((s) => s.settings.user_audio[user.id])
  // Their volume only matters while they're in our call (re-checked on every room change).
  const inMyCall = useVoice((s) => s.phase !== 'idle' && !!getRoom()?.remoteParticipants.has(user.id))
  const isMe = user.id === meId

  return (
    <>
      <Label>{user.display_name}</Label>
      {!isMe && inMyCall && (
        <SliderItem
          label="Volume"
          value={audio?.volume ?? 100}
          min={0}
          max={200}
          step={5}
          format={(v) => `${v}%`}
          onChange={(volume) => setUserAudio(user.id, { volume })}
        />
      )}
      {!isMe && (
        <CheckItem label="Silenciar para mim" checked={!!audio?.muted} onChange={() => setUserAudio(user.id, { muted: !audio?.muted })} />
      )}
    </>
  )
}

/** Small icon for someone the user muted locally. */
export function LocallyMuted({ userId, size = 14 }: { userId: string; size?: number }): ReactNode {
  const audio = useAppearance((s) => s.settings.user_audio[userId])
  if (!audio?.muted && (audio?.volume ?? 100) > 0) return null
  return <VolumeX size={size} aria-label="Silenciado para você" className="shrink-0 text-danger" />
}
