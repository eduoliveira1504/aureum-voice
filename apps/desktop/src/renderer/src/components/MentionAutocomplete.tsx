import { AtSign, Shield } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { Channel, Role, ServerDetail, User } from '../lib/api'
import { memberName } from '../lib/members'
import { mentionOptions, mentionQueryAt, mentionText, type MentionOption, type MentionSources } from '../lib/mentions'
import { channelPermissions, has, Perm } from '../lib/permissions'
import { t } from '../lib/i18n'
import { Avatar, menuClass } from './ui'

const SUGGESTIONS = 8

/**
 * Who and what can be mentioned in `channel`: in a server, the members who see it (by their
 * server name), the roles the user may mention and, with MENTION_EVERYONE, @all and @here; in a
 * group, its members. Never the user themself.
 */
export function mentionSourcesFor(
  channel: Channel,
  server: ServerDetail | undefined,
  dmMembers: { user: User }[] | undefined,
  meId: string | null
): MentionSources {
  if (!server) {
    const people = (dmMembers ?? []).filter((m) => m.user.id !== meId).map((m) => ({ user: m.user, name: m.user.display_name }))
    return { people, roles: [], everyone: false }
  }
  const people = server.members
    .filter((m) => m.user.id !== meId && has(channelPermissions(server, channel, m.user.id), Perm.VIEW_CHANNEL))
    .map((m) => ({ user: m.user, name: memberName(m) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const everyone = !!meId && has(channelPermissions(server, channel, meId), Perm.MENTION_EVERYONE)
  const roles = server.roles
    .filter((r) => r.id !== server.id && (everyone || r.mentionable))
    .sort((a, b) => b.position - a.position)
  return { people, roles, everyone }
}

/**
 * Suggestions while typing "@" in the message box (block 4.2.4 follow-up): people who see the
 * channel, roles that may be mentioned, @all and @here. ↑/↓ to choose, Enter or Tab to put it in
 * place of "@que", Esc to close. `onKeyDown` returns true when it used the key. A role goes in as
 * "@Nome" and `onRole` hears about it, so sending can turn it into the role's token.
 */
export function useMentionAutocomplete(
  text: string,
  caret: number,
  sources: MentionSources | null,
  replace: (start: number, end: number, text: string) => void,
  onRole: (role: Role) => void
): { popup: ReactNode; onKeyDown(e: { key: string; preventDefault(): void }): boolean } {
  const [active, setActive] = useState(0)
  const [closedAt, setClosedAt] = useState<number | null>(null)
  const query = sources ? mentionQueryAt(text, caret) : null
  useEffect(() => setActive(0), [query?.query, query?.start])
  const found = query && sources && closedAt !== query.start ? mentionOptions(query.query, sources, SUGGESTIONS) : []

  const choose = (option: MentionOption): void => {
    if (option.kind === 'role') onRole(option.role)
    replace(query!.start, caret, `${mentionText(option)} `)
  }
  const onKeyDown = (e: { key: string; preventDefault(): void }): boolean => {
    if (!found.length) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      choose(found[Math.min(active, found.length - 1)])
    } else if (e.key === 'Escape') {
      setClosedAt(query!.start)
    } else return false
    e.preventDefault()
    return true
  }

  const popup = found.length ? (
    <ul role="listbox" aria-label={t('chat.mention.list')} className={`${menuClass} absolute bottom-full left-0 mb-2 w-80`}>
      {found.map((option, i) => (
        <li key={option.key} role="option" aria-selected={i === active}>
          <button
            type="button"
            // mousedown, not click: the text box keeps focus and the caret.
            onMouseDown={(e) => {
              e.preventDefault()
              choose(option)
            }}
            onMouseEnter={() => setActive(i)}
            className={`flex w-full items-center gap-2.5 rounded-item px-2 py-1.5 text-left text-sm ${i === active ? 'bg-elevated text-fg' : 'text-fg-muted'}`}
          >
            <OptionRow option={option} />
          </button>
        </li>
      ))}
    </ul>
  ) : null
  return { popup, onKeyDown }
}

function OptionRow({ option }: { option: MentionOption }): ReactNode {
  if (option.kind === 'person') {
    return (
      <>
        <Avatar name={option.name} url={option.user.avatar_url} gif={option.user.avatar_gif} size={24} />
        <span className="min-w-0 flex-1 truncate font-medium">{option.name}</span>
        <span className="shrink-0 truncate text-xs text-fg-subtle">@{option.user.username}</span>
      </>
    )
  }
  if (option.kind === 'role') {
    return (
      <>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
          <Shield size={16} style={option.role.color ? { color: option.role.color } : undefined} />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium" style={option.role.color ? { color: option.role.color } : undefined}>
          @{option.role.name}
        </span>
        <span className="shrink-0 text-xs text-fg-subtle">{t('chat.mention.role')}</span>
      </>
    )
  }
  return (
    <>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        <AtSign size={16} />
      </span>
      <span className="shrink-0 font-medium">@{option.kind}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{option.kind === 'all' ? t('chat.mention.all') : t('chat.mention.here')}</span>
    </>
  )
}
