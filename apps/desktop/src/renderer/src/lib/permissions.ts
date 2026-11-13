/**
 * Server permissions, mirroring apps/api/app/permissions.py. The API checks everything on its
 * own; this only decides what the UI offers (buttons, menus, settings tabs).
 */

import type { Channel, Member, Role, ServerDetail } from './api'
import { i18n, t } from './i18n'

export const Perm = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_ROLES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  KICK_MEMBERS: 1 << 4,
  BAN_MEMBERS: 1 << 5,
  CREATE_INVITE: 1 << 6,
  CHANGE_NICKNAME: 1 << 7,
  MANAGE_NICKNAMES: 1 << 8,
  VIEW_CHANNEL: 1 << 9,
  SEND_MESSAGES: 1 << 10,
  ATTACH_FILES: 1 << 11,
  ADD_REACTIONS: 1 << 12,
  MENTION_EVERYONE: 1 << 13,
  MANAGE_MESSAGES: 1 << 14,
  READ_HISTORY: 1 << 15,
  CONNECT: 1 << 16,
  SPEAK: 1 << 17,
  VIDEO: 1 << 18,
  STREAM: 1 << 19,
  MUTE_MEMBERS: 1 << 20,
  DEAFEN_MEMBERS: 1 << 21,
  MOVE_MEMBERS: 1 << 22,
  MANAGE_ADDONS: 1 << 23,
  // Addon permissions. Bitwise math here is 32-bit: new bits stay at or below 1 << 30.
  EDIT_WHITEBOARD: 1 << 24,
  MANAGE_EVENTS: 1 << 25,
  MANAGE_EXPRESSIONS: 1 << 26,
  USE_STICKERS: 1 << 27,
  // Painel de sons. Only 1 << 30 is left after these.
  USE_SOUNDBOARD: 1 << 28,
  MANAGE_SOUNDBOARD: 1 << 29
} as const

export type PermName = keyof typeof Perm

export const ALL = (1 << 30) - 1
const VOICE_ONLY =
  Perm.SPEAK | Perm.VIDEO | Perm.STREAM | Perm.MUTE_MEMBERS | Perm.DEAFEN_MEMBERS | Perm.MOVE_MEMBERS | Perm.USE_SOUNDBOARD

/** Permissions a channel override can change (the rest are server-wide). */
export const CHANNEL_PERMS =
  Perm.MANAGE_CHANNELS |
  Perm.MANAGE_ROLES |
  Perm.CREATE_INVITE |
  Perm.VIEW_CHANNEL |
  Perm.SEND_MESSAGES |
  Perm.ATTACH_FILES |
  Perm.ADD_REACTIONS |
  Perm.MENTION_EVERYONE |
  Perm.MANAGE_MESSAGES |
  Perm.READ_HISTORY |
  Perm.CONNECT |
  VOICE_ONLY |
  Perm.MANAGE_ADDONS |
  Perm.EDIT_WHITEBOARD |
  Perm.MANAGE_EVENTS |
  Perm.USE_STICKERS

const OWNER_RANK = 1 << 30

export const has = (perms: number, perm: number): boolean => (perms & perm) !== 0

function rolesOf(server: ServerDetail, userId: string): Role[] {
  const ids = new Set(server.members.find((m) => m.user.id === userId)?.role_ids ?? [])
  return server.roles.filter((r) => ids.has(r.id))
}

/** The user's highest role position (0: only @everyone); the owner ranks above everything. */
export function rankOf(server: ServerDetail, userId: string): number {
  if (userId === server.owner_id) return OWNER_RANK
  return Math.max(0, ...rolesOf(server, userId).map((r) => r.position))
}

/** Whether the user can manage something of this rank (a role position or a member's rank). */
export const outranks = (server: ServerDetail, userId: string, rank: number): boolean =>
  userId === server.owner_id || rankOf(server, userId) > rank

/** Server-wide permissions: @everyone plus every role; owner and ADMINISTRATOR get all. */
export function basePermissions(server: ServerDetail, userId: string): number {
  if (userId === server.owner_id) return ALL
  let perms = server.roles.find((r) => r.id === server.id)?.permissions ?? 0
  for (const role of rolesOf(server, userId)) perms |= role.permissions
  return has(perms, Perm.ADMINISTRATOR) ? ALL : perms & ALL
}

/** Permissions in a channel: @everyone's override, then the roles' together, then the member's. */
export function channelPermissions(server: ServerDetail, channel: Channel, userId: string): number {
  let perms = basePermissions(server, userId)
  if (has(perms, Perm.ADMINISTRATOR)) return ALL
  const roleIds = new Set(rolesOf(server, userId).map((r) => r.id))
  const find = (type: 'role' | 'member', id: string) =>
    channel.overrides.find((o) => o.target_type === type && o.target_id === id)

  const everyone = find('role', server.id)
  if (everyone) perms = (perms & ~everyone.deny) | everyone.allow
  let deny = 0
  let allow = 0
  for (const o of channel.overrides) {
    if (o.target_type === 'role' && roleIds.has(o.target_id)) {
      deny |= o.deny
      allow |= o.allow
    }
  }
  perms = (perms & ~deny) | allow
  const own = find('member', userId)
  if (own) perms = (perms & ~own.deny) | own.allow

  if (!has(perms, Perm.VIEW_CHANNEL)) return 0
  if (channel.type === 'voice' && !has(perms, Perm.CONNECT)) perms &= ~VOICE_ONLY
  return perms & ALL
}

/** A private channel: hidden from @everyone (only some roles or members see it). */
export const isPrivate = (server: ServerDetail, channel: Channel): boolean =>
  channel.overrides.some((o) => o.target_type === 'role' && o.target_id === server.id && has(o.deny, Perm.VIEW_CHANNEL))

/** Who can see a channel, by the same rules as the API's channel_viewers. */
export const channelMembers = (server: ServerDetail, channel: Channel): Member[] =>
  server.members.filter((m) => has(channelPermissions(server, channel, m.user.id), Perm.VIEW_CHANNEL))

/** What the user may do to a channel itself: open its settings (any tab) and delete it.
 * Deleting an addon channel deletes the addon's data too, so it also takes MANAGE_ADDONS. */
export function channelActions(server: ServerDetail, channel: Channel, userId: string): { canSettings: boolean; canDelete: boolean } {
  const perms = channelPermissions(server, channel, userId)
  const addon = channel.type === 'addon'
  return {
    canSettings: has(perms, Perm.MANAGE_CHANNELS | Perm.MANAGE_ROLES) || (addon && has(perms, Perm.MANAGE_ADDONS)),
    canDelete: has(perms, Perm.MANAGE_CHANNELS) && (!addon || has(perms, Perm.MANAGE_ADDONS))
  }
}

/** The member's strongest role with a color (names are shown in it), if any. */
export function roleColor(server: ServerDetail, userId: string): string | null {
  return (
    rolesOf(server, userId)
      .filter((r) => r.color)
      .sort((a, b) => b.position - a.position)[0]?.color ?? null
  )
}

/** A permission's label and description, read in the app's language when used (getters). */
function info(perm: PermName): { perm: PermName; readonly label: string; readonly description: string } {
  return {
    perm,
    get label() {
      return t(`permissions.perms.${perm}.label`)
    },
    get description() {
      const key = `permissions.perms.${perm}.description` as const
      return i18n.exists(key) ? t(key as never) : ''
    }
  }
}

/** Labels and descriptions for the settings screens, grouped as shown there. */
export const PERMISSION_GROUPS: { readonly title: string; items: ReturnType<typeof info>[] }[] = (
  [
    ['server', ['ADMINISTRATOR', 'MANAGE_SERVER', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'KICK_MEMBERS', 'BAN_MEMBERS', 'CREATE_INVITE', 'CHANGE_NICKNAME', 'MANAGE_NICKNAMES']],
    ['text', ['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_HISTORY', 'MANAGE_MESSAGES', 'ATTACH_FILES', 'ADD_REACTIONS', 'USE_STICKERS', 'MANAGE_EXPRESSIONS', 'MENTION_EVERYONE']],
    ['voice', ['CONNECT', 'SPEAK', 'VIDEO', 'STREAM', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS', 'USE_SOUNDBOARD', 'MANAGE_SOUNDBOARD']],
    ['addons', ['MANAGE_ADDONS', 'EDIT_WHITEBOARD', 'MANAGE_EVENTS']]
  ] as const
).map(([key, perms]) => ({
  get title() {
    return t(`permissions.groups.${key}`)
  },
  items: perms.map(info)
}))

export type PermInfo = (typeof PERMISSION_GROUPS)[number]['items'][number]

export const PERM_INFO = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.items.map((item) => [item.perm, item]))
) as Record<PermName, PermInfo>
