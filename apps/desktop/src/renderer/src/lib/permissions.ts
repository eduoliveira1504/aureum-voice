/**
 * Server permissions, mirroring apps/api/app/permissions.py. The API checks everything on its
 * own; this only decides what the UI offers (buttons, menus, settings tabs).
 */

import type { Channel, Role, ServerDetail } from './api'

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
  MANAGE_ADDONS: 1 << 23
} as const

export type PermName = keyof typeof Perm

export const ALL = (1 << 24) - 1
const VOICE_ONLY = Perm.SPEAK | Perm.VIDEO | Perm.STREAM | Perm.MUTE_MEMBERS | Perm.DEAFEN_MEMBERS | Perm.MOVE_MEMBERS

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
  Perm.MANAGE_ADDONS

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

/** The member's strongest role with a color (names are shown in it), if any. */
export function roleColor(server: ServerDetail, userId: string): string | null {
  return (
    rolesOf(server, userId)
      .filter((r) => r.color)
      .sort((a, b) => b.position - a.position)[0]?.color ?? null
  )
}

/** Labels and descriptions for the settings screens, grouped as shown there. */
export const PERMISSION_GROUPS: { title: string; items: { perm: PermName; label: string; description: string }[] }[] = [
  {
    title: 'Servidor',
    items: [
      { perm: 'ADMINISTRATOR', label: 'Administrador', description: 'Tem todas as permissões e ignora as dos canais. Cuidado ao dar.' },
      { perm: 'MANAGE_SERVER', label: 'Gerenciar servidor', description: 'Mudar nome, ícone e banner.' },
      { perm: 'MANAGE_ROLES', label: 'Gerenciar cargos', description: 'Criar e editar cargos abaixo do seu e as permissões dos canais.' },
      { perm: 'MANAGE_CHANNELS', label: 'Gerenciar canais', description: 'Criar, renomear e excluir canais.' },
      { perm: 'KICK_MEMBERS', label: 'Expulsar membros', description: 'Tirar do servidor quem está abaixo de você.' },
      { perm: 'BAN_MEMBERS', label: 'Banir membros', description: 'Expulsar e impedir de voltar.' },
      { perm: 'CREATE_INVITE', label: 'Criar convites', description: 'Convites também criam contas novas no Aureum.' },
      { perm: 'CHANGE_NICKNAME', label: 'Mudar apelido', description: 'Escolher o próprio apelido neste servidor.' },
      { perm: 'MANAGE_NICKNAMES', label: 'Gerenciar apelidos', description: 'Mudar o apelido de quem está abaixo de você.' },
      { perm: 'MANAGE_ADDONS', label: 'Gerenciar addons', description: 'Reservado: addons chegam numa próxima versão.' }
    ]
  },
  {
    title: 'Conversas',
    items: [
      { perm: 'VIEW_CHANNEL', label: 'Ver canais', description: 'Sem isso o canal fica invisível.' },
      { perm: 'SEND_MESSAGES', label: 'Enviar mensagens', description: '' },
      { perm: 'READ_HISTORY', label: 'Ler histórico', description: 'Sem isso, só vê o que chegar enquanto está com o canal aberto.' },
      { perm: 'MANAGE_MESSAGES', label: 'Gerenciar mensagens', description: 'Apagar mensagens dos outros.' },
      { perm: 'ATTACH_FILES', label: 'Enviar arquivos', description: 'Reservado: anexos chegam numa próxima versão.' },
      { perm: 'ADD_REACTIONS', label: 'Reagir', description: 'Reservado: reações chegam numa próxima versão.' },
      { perm: 'MENTION_EVERYONE', label: 'Mencionar @everyone', description: 'Reservado: menções a cargos chegam numa próxima versão.' }
    ]
  },
  {
    title: 'Salas de voz',
    items: [
      { perm: 'CONNECT', label: 'Conectar', description: 'Entrar na sala.' },
      { perm: 'SPEAK', label: 'Falar', description: '' },
      { perm: 'VIDEO', label: 'Câmera', description: '' },
      { perm: 'STREAM', label: 'Transmitir tela', description: '' },
      { perm: 'MUTE_MEMBERS', label: 'Silenciar membros', description: 'Desligar o microfone de quem está abaixo de você, até liberar.' },
      { perm: 'DEAFEN_MEMBERS', label: 'Ensurdecer membros', description: 'Cortar o áudio (e o microfone) de quem está abaixo de você.' },
      { perm: 'MOVE_MEMBERS', label: 'Mover membros', description: 'Levar quem está abaixo de você para outra sala.' }
    ]
  }
]

export type PermInfo = (typeof PERMISSION_GROUPS)[number]['items'][number]

export const PERM_INFO = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.items.map((item) => [item.perm, item]))
) as Record<PermName, PermInfo>
