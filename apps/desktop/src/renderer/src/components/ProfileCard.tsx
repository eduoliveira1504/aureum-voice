import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { mediaUrl, type User } from '../lib/api'
import { Avatar } from './ui'

const DEFAULT_BANNER = '#d4a72c'
const joinedFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })

/** Profile body (banner, avatar, names, bio); used by the popover and the settings preview. */
export function ProfileView({ user, footer }: { user: User; footer?: ReactNode }): ReactNode {
  const banner = mediaUrl(user.banner_url)
  return (
    <div className="w-[300px] overflow-hidden rounded-lg bg-surface-0 shadow-2xl">
      <div className="h-[106px]" style={{ background: user.accent_color ?? DEFAULT_BANNER }}>
        {banner && <img src={banner} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="relative px-4 pb-4">
        <div className="-mt-10 inline-block rounded-full border-[6px] border-surface-0">
          <Avatar name={user.display_name} url={user.avatar_url} size={80} />
        </div>
        <div className="mt-1 rounded-lg bg-surface-1 p-3">
          <div className="text-lg font-bold leading-tight" style={user.accent_color ? { color: user.accent_color } : undefined}>
            {user.display_name}
          </div>
          <div className="text-sm text-fg-muted">@{user.username}</div>
          {user.bio && (
            <>
              <div className="my-2.5 h-px bg-surface-3" />
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-fg-muted">Sobre mim</div>
              <p className="select-text whitespace-pre-wrap break-words text-sm">{user.bio}</p>
            </>
          )}
          <div className="my-2.5 h-px bg-surface-3" />
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-fg-muted">Membro desde</div>
          <p className="text-sm">{joinedFmt.format(new Date(user.created_at))}</p>
          {footer}
        </div>
      </div>
    </div>
  )
}

/** Popover with a user's profile, positioned next to the element that opened it. */
export function ProfilePopover({ user, anchor, onClose }: { user: User; anchor: DOMRect; onClose(): void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.right + 8, top: anchor.top })

  // Keep the card on screen: open to the left if there's no room on the right, clamp vertically.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = anchor.right + 8 + width > window.innerWidth ? anchor.left - width - 8 : anchor.right + 8
    const top = Math.max(8, Math.min(anchor.top, window.innerHeight - height - 8))
    setPos({ left: Math.max(8, left), top })
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div ref={ref} role="dialog" aria-label={`Perfil de ${user.display_name}`} className="fixed z-50" style={pos}>
      <ProfileView user={user} />
    </div>
  )
}

/** Hook for anything that opens a profile popover on click. */
export function useProfilePopover(): {
  open(user: User, target: Element): void
  popover: ReactNode
} {
  const [state, setState] = useState<{ user: User; anchor: DOMRect } | null>(null)
  return {
    open: (user, target) => setState({ user, anchor: target.getBoundingClientRect() }),
    popover: state ? <ProfilePopover user={state.user} anchor={state.anchor} onClose={() => setState(null)} /> : null
  }
}
