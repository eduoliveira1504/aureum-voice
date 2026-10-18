import { Phone, PhoneMissed, PhoneOff, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { loopSound, playSound } from '../lib/sounds'
import { useAppearance } from '../store/appearance'
import { useNav } from '../store/nav'
import { dmTitle, RING_MS, useSocial } from '../store/social'
import { useVoice } from '../store/voice'
import { Avatar } from './ui'

/** "X is calling you" with answer/decline. Rings for 30 s. (In Do not disturb calls don't ring:
 * see MissedCallNotice.) */
export function IncomingCall({ meId }: { meId: string }): ReactNode {
  const ringing = useSocial((s) => s.ringing)
  const dm = useSocial((s) => (ringing ? s.dms[ringing.call.channel_id] : undefined))
  const sounds = useAppearance((s) => s.settings.sounds)
  const status = useAppearance((s) => s.settings.status)
  const { answer, decline, dismissRing } = useSocial.getState()
  const callId = ringing?.call.id

  const since = ringing?.since
  useEffect(() => {
    if (since === undefined) return
    const timer = setTimeout(dismissRing, Math.max(0, since + RING_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [since, callId, dismissRing])

  useEffect(() => {
    if (!callId) return
    return loopSound('call-ringing', { fromOthers: true })
  }, [callId, sounds, status])

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

const NOTICE_MS = 10_000

/** A call that came in during Do not disturb: a small corner note instead of the popup. */
export function MissedCallNotice({ meId }: { meId: string }): ReactNode {
  const call = useSocial((s) => s.missedNotice)
  const dm = useSocial((s) => (call ? s.dms[call.channel_id] : undefined))
  const dismiss = useSocial((s) => s.dismissMissedNotice)

  useEffect(() => {
    if (!call) return
    const timer = setTimeout(dismiss, NOTICE_MS)
    return () => clearTimeout(timer)
  }, [call, dismiss])

  if (!call || !dm) return null
  const caller = dm.members.find((m) => m.user.id === call.started_by)?.user
  const open = (): void => {
    useNav.getState().openHome(call.channel_id)
    dismiss()
  }
  return (
    <div role="status" className="fixed bottom-6 right-6 z-50 flex w-[300px] items-center gap-3 rounded-panel border border-line bg-panel p-3 shadow-xl">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-item bg-danger/15 text-danger">
        <PhoneMissed size={18} />
      </span>
      <button type="button" onClick={open} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold">Chamada perdida</span>
        <span className="block truncate text-xs text-fg-muted">
          {caller?.display_name ?? 'Alguém'}
          {dm.type === 'group_dm' ? ` · ${dmTitle(dm, meId)}` : ''}
        </span>
      </button>
      <button type="button" aria-label="Fechar" onClick={dismiss} className="rounded-item p-1 text-fg-subtle hover:bg-elevated hover:text-fg">
        <X size={16} />
      </button>
    </div>
  )
}

const OUTGOING_DELAY_MS = 700

type Outgoing ='ringing' | 'answered' | 'declined' | 'unanswered'

/** Where a private call we're in stands from our side, while nobody else has joined yet. */
function outgoingState(channelId: string, meId: string): Outgoing | null {
  const call = useSocial.getState().dms[channelId]?.call
  if (!call) return null
  const others = call.participants.filter((p) => p.user_id !== meId)
  if (others.some((p) => p.joined_at)) return 'answered'
  const stillRinging = others.some((p) => p.rung_at && !p.declined_at && Date.now() - new Date(p.rung_at).getTime() < RING_MS)
  if (stillRinging) return 'ringing'
  return others.length > 0 && others.every((p) => p.declined_at) ? 'declined' : 'unanswered'
}

/**
 * The private call we're in, from our side: plays the outgoing ring while the others are being
 * called, and hangs up once nobody can answer anymore (everyone declined or let it ring out, and
 * no one else ever joined). If people joined and left, we stay, like in any call.
 */
export function useOutgoingCall(meId: string): void {
  const channelId = useVoice((s) => (s.phase === 'connected' && !s.serverId ? s.channelId : null))
  const [ringing, setRinging] = useState(false)
  const sounds = useAppearance((s) => s.settings.sounds)

  useEffect(() => {
    if (!channelId) return
    const check = (): void => {
      const state = outgoingState(channelId, meId)
      setRinging(state === 'ringing')
      if (state !== 'declined' && state !== 'unanswered') return
      void useVoice.getState().leave(true)
      playSound('call-ended')
      useVoice.setState({ error: state === 'declined' ? 'A chamada foi recusada.' : 'Ninguém atendeu.' })
    }
    check()
    const timer = setInterval(check, 1000)
    return () => {
      clearInterval(timer)
      setRinging(false)
    }
  }, [channelId, meId])

  useEffect(() => {
    if (!ringing) return
    let stop = (): void => {}
    // Starts after the join sound, so the two don't blur together.
    const timer = setTimeout(() => (stop = loopSound('call-outgoing')), OUTGOING_DELAY_MS)
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [ringing, sounds])
}
