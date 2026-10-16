import type { ReactNode } from 'react'

import type { Member, ServerDetail, User } from '../lib/api'
import { useProfilePopover } from './ProfileCard'
import { Avatar } from './ui'

const ROLE_ORDER = { owner: 0, admin: 1, member: 2 }

export function MemberList({ server }: { server: ServerDetail }): ReactNode {
  const sorted = [...server.members].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.user.display_name.localeCompare(b.user.display_name)
  )
  const online = sorted.filter((m) => m.online)
  const offline = sorted.filter((m) => !m.online)
  const profile = useProfilePopover()

  return (
    <aside className="hidden w-60 shrink-0 overflow-y-auto bg-surface-1 px-2 py-4 lg:block">
      <Group title={`Online — ${online.length}`} members={online} onOpen={profile.open} />
      {offline.length > 0 && <Group title={`Offline — ${offline.length}`} members={offline} onOpen={profile.open} />}
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
      <h3 className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-fg-subtle">{title}</h3>
      {members.map((m) => (
        <button
          key={m.user.id}
          type="button"
          onClick={(e) => onOpen(m.user, e.currentTarget)}
          className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-surface-3/50 ${m.online ? '' : 'opacity-40'}`}
        >
          <div className="relative">
            <Avatar name={m.user.display_name} url={m.user.avatar_url} />
            {m.online && <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-surface-1 bg-green-500" />}
          </div>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" style={m.user.accent_color ? { color: m.user.accent_color } : undefined}>
            {m.user.display_name}
          </span>
          {m.role === 'owner' && <span title="Dono do servidor" className="text-xs text-accent">👑</span>}
        </button>
      ))}
    </section>
  )
}
