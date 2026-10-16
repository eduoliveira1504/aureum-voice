import { Crown, X } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Member, ServerDetail, User } from '../lib/api'
import { useReadableColor } from '../store/appearance'
import { useProfilePopover } from './ProfileCard'
import { PresenceAvatar } from './ui'

const ROLE_ORDER = { owner: 0, admin: 1, member: 2 }

/** Collapsible side panel, opened from the "Membros" button of a panel. */
export function MemberList({ server, onClose }: { server: ServerDetail; onClose(): void }): ReactNode {
  const sorted = [...server.members].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.user.display_name.localeCompare(b.user.display_name)
  )
  const online = sorted.filter((m) => m.online)
  const offline = sorted.filter((m) => !m.online)
  const profile = useProfilePopover()

  return (
    <aside aria-label="Membros" className="flex h-full w-60 shrink-0 flex-col bg-panel">
      <header className="flex h-12 shrink-0 items-center border-b border-line pl-4 pr-2">
        <h2 className="flex-1 font-display text-[15px] font-semibold">Membros</h2>
        <button
          type="button"
          title="Fechar membros"
          aria-label="Fechar membros"
          onClick={onClose}
          className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
        >
          <X size={18} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-2 py-4">
      <Group title={`Online — ${online.length}`} members={online} onOpen={profile.open} />
      {offline.length > 0 && <Group title={`Offline — ${offline.length}`} members={offline} onOpen={profile.open} />}
      </div>
      {profile.popover}
    </aside>
  )
}

function Group({
  title,
  members,
  onOpen
}: {
  title: string
  members: Member[]
  onOpen(user: User, target: Element): void
}): ReactNode {
  return (
    <section className="mb-5">
      <h3 className="mb-1 px-2 font-sans text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
      {members.map((m) => (
        <MemberRow key={m.user.id} member={m} onOpen={onOpen} />
      ))}
    </section>
  )
}

function MemberRow({ member: m, onOpen }: { member: Member; onOpen(user: User, target: Element): void }): ReactNode {
  const nameColor = useReadableColor(m.user.accent_color)
  return (
    <button
      type="button"
      onClick={(e) => onOpen(m.user, e.currentTarget)}
      className={`flex w-full items-center gap-3 rounded-item px-2 py-1.5 text-left hover:bg-elevated/60 ${m.online ? '' : 'opacity-40'}`}
    >
      <PresenceAvatar name={m.user.display_name} url={m.user.avatar_url} status={m.online ? m.status : undefined} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" style={nameColor ? { color: nameColor } : undefined}>
        {m.user.display_name}
      </span>
      {m.role === 'owner' && <Crown size={14} aria-label="Dono do servidor" className="shrink-0 text-accent-text" />}
    </button>
  )
}
