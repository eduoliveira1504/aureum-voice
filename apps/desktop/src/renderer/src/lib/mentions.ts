/**
 * Mentions in a message (block 4.2.4 follow-up; the API's rules are in apps/api/app/reads.py):
 * "@username" for a person, "<@&role id>" for a role, "@all" for everyone who can see the channel
 * and "@here" for those of them online. Roles, @all and @here need MENTION_EVERYONE, except roles
 * marked mentionable.
 */

import type { Role, ServerDetail, User } from './api'

export const MENTION_ALL = 'all'
export const MENTION_HERE = 'here'
export const ROLE_MENTION = /<@&([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/g

export type MentionOption =
  | { kind: 'person'; key: string; user: User; name: string }
  | { kind: 'role'; key: string; role: Role }
  | { kind: 'all' | 'here'; key: string }

/** The "@que" being typed right before the caret (just "@" too), or null. */
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const match = /(^|\s)@([\p{L}\p{N}_.]{0,32})$/u.exec(text.slice(0, caret))
  return match ? { query: match[2], start: caret - match[2].length - 1 } : null
}

/** Lowercase without accents, for matching what was typed. */
const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Starts with the query, or one of its words does ("silva" finds "Ana Silva"). */
function matches(query: string, ...names: string[]): boolean {
  const q = fold(query)
  return names.some((n) => fold(n).startsWith(q) || fold(n).split(/\s+/).some((w) => w.startsWith(q)))
}

export interface MentionSources {
  /** Who can be mentioned here (who sees the channel), besides the user. */
  people: { user: User; name: string }[]
  /** The server's roles the user may mention (not @everyone's). */
  roles: Role[]
  /** @all and @here (a server channel, with MENTION_EVERYONE). */
  everyone: boolean
}

/** What to offer for `query`, best first: @all/@here, then people, then roles. */
export function mentionOptions(query: string, { people, roles, everyone }: MentionSources, max: number): MentionOption[] {
  const out: MentionOption[] = []
  if (everyone) {
    for (const kind of [MENTION_ALL, MENTION_HERE] as const) if (kind.startsWith(fold(query))) out.push({ kind, key: kind })
  }
  for (const p of people) {
    if (matches(query, p.user.username, p.name, p.user.display_name)) out.push({ kind: 'person', key: `u:${p.user.id}`, user: p.user, name: p.name })
  }
  for (const role of roles) if (matches(query, role.name)) out.push({ kind: 'role', key: `r:${role.id}`, role })
  return out.slice(0, max)
}

/** A role's name by id, out of these servers (for previews, which have no chat around them). */
export function roleNameIn(servers: Iterable<Pick<ServerDetail, 'roles'>>): (id: string) => string | undefined {
  return (id) => {
    for (const server of servers) {
      const role = server.roles.find((r) => r.id === id)
      if (role) return role.name
    }
    return undefined
  }
}

/** Role tokens as "@Nome", for plain text (previews, notifications). */
export function plainMentions(text: string, roleName: (id: string) => string | undefined, fallback: string): string {
  return text.replace(ROLE_MENTION, (_, id: string) => `@${roleName(id) ?? fallback}`)
}

/** What goes in the text box: roles by name (readable while typing), turned into their token on send. */
export function mentionText(option: MentionOption): string {
  if (option.kind === 'person') return `@${option.user.username}`
  if (option.kind === 'role') return `@${option.role.name}`
  return `@${option.kind}`
}

/**
 * The text to send: each role picked from the list, still written as "@Nome", becomes "<@&id>".
 * Longer names first, so "@Time A" isn't eaten by "@Time".
 */
export function withRoleTokens(text: string, picked: Role[]): string {
  const roles = [...new Map(picked.map((r) => [r.id, r])).values()].sort((a, b) => b.name.length - a.name.length)
  let out = text
  for (const role of roles) {
    const name = role.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(^|\\s)@${name}(?![\\p{L}\\p{N}_])`, 'gu'), `$1<@&${role.id}>`)
  }
  return out
}
