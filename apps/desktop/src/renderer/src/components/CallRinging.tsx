import { Phone, PhoneOff } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

import { startRingtone } from '../lib/ringtone'
import { useAppearance } from '../store/appearance'
import { dmTitle, RING_MS, useSocial } from '../store/social'
import { useVoice } from '../store/voice'
import { Avatar } from './ui'

/** "X is calling you" with answer/decline. Rings for 30 s; Do not disturb keeps it silent. */
export function IncomingCall({ meId }: { meId: string }): ReactNode {
  const ringing = useSocial((s) => s.ringing)
  const dm = useSocial((s) => (ringing ? s.dms[ringing.call.channel_id] : undefined))
  const status = useAppearance((s) => s.settings.status)
  const sounds = useAppearance((s) => s.settings.sounds)
  const { answer, decline, dismissRing } = useSocial.getState()
  const callId = ringing?.call.id

  const since = ringing?.since
  useEffect(() => {
    if (since === undefined) return
    const timer = setTimeout(dismissRing, Math.max(0, since + RING_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [since, callId, dismissRing])

  const silent = status === 'dnd' || sounds.events['call.ringing'] === false
  useEffect(() => {
    if (!callId || silent) return
    return startRingtone(sounds.volume / 100)
  }, [callId, silent, sounds.volume])

  if (!ringing || !dm) return null
  const caller = dm.members.find((m) => m.user.id === ringing.call.started_by)?.user
  const name = caller?.display_name ?? 'Alguém'
  const group = dm.type === 'group_dm'

  return (
    <div
      role="alertdialog"
      aria-label={`${name} está te ligando`}
      className="fixed left-1/2 top-16 z-50 w-[340px] -translate-x-1/2 rounded-panel border border-line bg-panel p-4 shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <span className="relative">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/40" />
          <span className="relative block rounded-full ring-2 ring-accent">
            <Avatar name={name} url={caller?.avatar_url} size={52} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[17px] font-semibold">{name}</div>
          <div className="truncate text-sm text-fg-muted">
            {group ? `está chamando · ${dmTitle(dm, meId)}` : 'está te ligando'}
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={decline}
          className="flex items-center justify-center gap-2 rounded-control bg-danger py-2.5 font-semibold text-on-danger hover:bg-danger/85"
        >
          <PhoneOff size={18} />
          Recusar
        </button>
        <button
          type="button"
          autoFocus
          onClick={answer}
          className="flex items-center justify-center gap-2 rounded-control bg-accent py-2.5 font-semibold text-on-accent hover:bg-accent-hover"
        >
          <Phone size={18} />
          Atender
        </button>
      </div>
    </div>
  )
}

/**
 * Hangs up a private call we're alone in once nobody can answer anymore: everyone declined or
 * let it ring out, and no one else ever joined. (If people joined and left, we stay, like in
 * any call.)
 */
export function useNoAnswerHangup(meId: string): void {
  const channelId = useVoice((s) => (s.phase !== 'idle' && !s.serverId ? s.channelId : null))
  useEffect(() => {
    if (!channelId) return
    const check = (): void => {
      const call = useSocial.getState().dms[channelId]?.call
      if (!call) return
      const others = call.participants.filter((p) => p.user_id !== meId)
      if (others.some((p) => p.joined_at)) return
      const stillRinging = others.some(
        (p) => p.rung_at && !p.declined_at && Date.now() - new Date(p.rung_at).getTime() < RING_MS
      )
      if (stillRinging) return
      const declined = others.length > 0 && others.every((p) => p.declined_at)
      void useVoice.getState().leave()
      useVoice.setState({ error: declined ? 'A chamada foi recusada.' : 'Ninguém atendeu.' })
    }
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [channelId, meId])
}
