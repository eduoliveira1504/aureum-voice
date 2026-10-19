import { Gamepad2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { Activity, AvatarFrame, CustomStatus, Presence, User } from '../lib/api'
import { useUserActivity } from '../store/activity'
import { ACCENT_PRESETS } from '../store/appearance'
import { Avatar, StatusDot } from './ui'

/** Fixed frame colors; 'accent' follows the profile color (or the app accent without one). */
const FRAME_KEYS = ['gold', 'amethyst', 'emerald', 'ember', 'sapphire'] as const
export const FRAME_PRESETS = ACCENT_PRESETS.map((preset, i) => ({ key: FRAME_KEYS[i] as AvatarFrame, ...preset }))

/** CSS color of a frame, or null for none. */
export function frameColor(frame: AvatarFrame, profileColor: string | null): string | null {
  if (frame === 'none') return null
  if (frame === 'accent') return profileColor ?? 'var(--accent)'
  return FRAME_PRESETS.find((p) => p.key === frame)?.hex ?? null
}

/** Avatar with the user's frame (a ring with a gap) and, optionally, the presence dot. */
export function FramedAvatar({
  user,
  size,
  status,
  surface = 'var(--bg-panel)',
  border = 'border-panel'
}: {
  user: Pick<User, 'display_name' | 'avatar_url' | 'avatar_frame' | 'accent_color'>
  size: number
  status?: Presence
  /** Color behind the avatar, used for the gap inside the frame. */
  surface?: string
  border?: string
}): ReactNode {
  const color = frameColor(user.avatar_frame, user.accent_color)
  const ring = Math.max(2, Math.round(size / 24))
  const dot = Math.max(10, Math.round(size * 0.26))
  return (
    <span
      className="relative inline-block shrink-0 rounded-full"
      style={color ? { boxShadow: `0 0 0 ${ring}px ${surface}, 0 0 0 ${ring * 2}px ${color}` } : undefined}
    >
      <Avatar name={user.display_name} url={user.avatar_url} size={size} />
      {status && (
        <StatusDot status={status} size={dot} border={border} className="absolute bottom-[4%] right-[4%] border-[3px]" />
      )}
    </span>
  )
}

/** The custom status while it hasn't expired; re-renders when it does. */
export function useCustomStatus(user: Pick<User, 'custom_status'>): CustomStatus | null {
  const status = user.custom_status
  const expires = status?.expires_at ? new Date(status.expires_at).getTime() : null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (expires === null || expires <= Date.now()) return
    // setTimeout tops out at ~24.8 days; longer statuses just get checked again then.
    const timer = setTimeout(() => setNow(Date.now()), Math.min(expires - Date.now() + 50, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [expires, now])
  if (!status || (expires !== null && expires <= now)) return null
  return status
}

/**
 * Speech bubble with the custom status (emoji + text). `tail` is the side pointing at the
 * avatar it belongs to. Nothing when there's no status or it expired.
 */
export function StatusBubble({
  user,
  tail = 'left',
  size = 'sm',
  className = ''
}: {
  user: Pick<User, 'custom_status'>
  tail?: 'left' | 'bottom-left'
  size?: 'xs' | 'sm'
  className?: string
}): ReactNode {
  const status = useCustomStatus(user)
  if (!status) return null
  const text = [status.emoji, status.text].filter(Boolean).join(' ')
  const tailClass = tail === 'left' ? 'left-[-4.5px] top-1/2 -mt-1 border-b border-l' : 'bottom-[-4.5px] left-3 border-b border-r'
  return (
    <span
      title={text}
      className={`relative inline-flex max-w-full items-center gap-1 rounded-control border border-line bg-elevated text-fg ${
        size === 'xs' ? 'px-1.5 py-px text-[11px]' : 'px-2.5 py-1 text-xs'
      } ${className}`}
    >
      <span
        aria-hidden
        className={`absolute h-2 w-2 rotate-45 border-line bg-elevated ${tailClass}`}
      />
      {status.emoji && <span className="relative shrink-0">{status.emoji}</span>}
      {status.text && <span className="relative truncate">{status.text}</span>}
    </span>
  )
}

/** "há 5 min", "há 2 h": how long an activity has been going, updated every minute. */
export function useElapsed(since: string | undefined): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [since])
  if (!since) return null
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000))
  if (minutes < 1) return 'agora há pouco'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `há ${hours} h${minutes % 60 && hours < 10 ? ` ${minutes % 60} min` : ''}`
}

export const activityLabel = (activity: Activity): string => `Jogando ${activity.name}`

/** Small "Jogando X" line (member lists, Active now). */
export function ActivityLine({ userId, className = '' }: { userId: string; className?: string }): ReactNode {
  const activity = useUserActivity(userId)
  if (!activity) return null
  return (
    <span className={`flex min-w-0 items-center gap-1 text-xs text-fg-subtle ${className}`} title={activityLabel(activity)}>
      <Gamepad2 size={12} strokeWidth={1.8} className="shrink-0" />
      <span className="truncate">{activityLabel(activity)}</span>
    </span>
  )
}

