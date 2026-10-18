import { Crown, Volume2, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { mediaUrl, type Member, type Role, type ServerDetail, type User } from '../lib/api'
import { memberName } from '../lib/members'
import { roleColor } from '../lib/permissions'
import { useReadableColor } from '../store/appearance'
import { contextMenu } from './ContextMenu'
import { useProfilePopover } from './ProfileCard'
import { COLUMNS, useColumnWidth } from './Resizer'
import { PresenceAvatar } from './ui'
import { UserMenu } from './UserMenu'

export interface MemberGroup {
  key: string
  title: string
  members: Member[]
}

/**
 * Online members under their strongest role shown separately (hoist), the rest under
 * "Online", and everyone offline at the end (key 'offline').
 */
export function groupMembers(server: ServerDetail): MemberGroup[] {
  const byName = (a: Member, b: Member): number => memberName(a).localeCompare(memberName(b))
  const hoisted = server.roles.filter((r) => r.hoist && r.id !== server.id) // strongest first
  const groups = new Map<string, MemberGroup>(hoisted.map((r) => [r.id, { key: r.id, title: r.name, members: [] }]))
  const online: MemberGroup = { key: 'online', title: 'Online', members: [] }
  const offline: MemberGroup = { key: 'offline', title: 'Offline', members: [] }
  for (const member of server.members) {
    if (!member.online) {
      offline.members.push(member)
      continue
    }
    const top = hoisted.find((r) => member.role_ids.includes(r.id))
    ;(top ? groups.get(top.id)! : online).members.push(member)
  }
  return [...groups.values(), online, offline].filter((g) => g.members.length).map((g) => ({ ...g, members: g.members.sort(byName) }))
}

/** Collapsible side panel, opened from the "Membros" button of a panel. */
export function MemberList({ server, meId, onClose }: { server: ServerDetail; meId: string; onClose(): void }): ReactNode {
  const profile = useProfilePopover()
  const roles = new Map(server.roles.map((r) => [r.id, r]))
  const { width, handle } = useColumnWidth(COLUMNS.members, 'left')

  return (
    <aside aria-label="Membros" style={{ width }} className="relative flex h-full shrink-0 flex-col bg-panel">
      {handle}
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
        {groupMembers(server).map((group) => (
          <section key={group.key} className="mb-5">
            <h3 className="mb-1 truncate px-2 font-sans text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {group.title} — {group.members.length}
            </h3>
            {group.members.map((m) => (
              <MemberRow key={m.user.id} member={m} server={server} roles={roles} meId={meId} onOpen={profile.open} />
            ))}
          </section>
        ))}
      </div>
      {profile.popover}
    </aside>
  )
}

/** One member: avatar with presence, name in their role color, role icon and owner crown. Click
 * opens the profile; right click, the member's menu. `room` is the voice room they're in. */
export function MemberRow({
  member: m,
  server,
  roles,
  meId,
  room,
  onOpen
}: {
  member: Member
  server: ServerDetail
  roles: Map<string, Role>
  meId: string
  room?: string | null
  onOpen(user: User, target: Element): void
}): ReactNode {
  const nameColor = useReadableColor(roleColor(server, m.user.id) ?? m.user.accent_color)
  const icon = m.role_ids.map((id) => roles.get(id)).find((r) => r?.icon_url)
  const name = memberName(m)
  return (
    <button
      type="button"
      onClick={(e) => onOpen(m.user, e.currentTarget)}
      onContextMenu={contextMenu(() => <UserMenu user={m.user} meId={meId} />)}
      className={`flex w-full items-center gap-3 rounded-item px-2 py-1.5 text-left hover:bg-elevated/60 ${m.online ? '' : 'opacity-40'}`}
    >
      <PresenceAvatar name={name} url={m.user.avatar_url} status={m.online ? m.status : undefined} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium" style={nameColor ? { color: nameColor } : undefined}>
          {name}
        </span>
        {room && (
          <span className="flex items-center gap-1 truncate text-xs text-fg-subtle">
            <Volume2 size={11} className="shrink-0" />
            {room}
          </span>
        )}
      </span>
      {icon?.icon_url && <img src={mediaUrl(icon.icon_url)} alt={icon.name} title={icon.name} className="h-4 w-4 shrink-0 object-contain" />}
      {m.user.id === server.owner_id && <Crown size={14} aria-label="Dono do servidor" className="shrink-0 text-accent-text" />}
    </button>
  )
}
