import type { Member, ServerDetail, User } from './api'

/** A member's name inside their server: the nickname, else the display name. */
export function memberName(member: Member): string {
  return member.nickname || member.user.display_name
}

/** The server's people by user id, with nicknames as display names (for calls and lists
 * that only know about users). */
export function serverPeople(server: ServerDetail): Map<string, User> {
  return new Map(server.members.map((m) => [m.user.id, m.nickname ? { ...m.user, display_name: m.nickname } : m.user]))
}
