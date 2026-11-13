import {
  ArrowRightLeft,
  Ban,
  Check,
  Copy,
  Gavel,
  MessageCircle,
  Pencil,
  Phone,
  Shield,
  UserMinus,
  UserPlus,
  UserRound,
  UserX,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'

import { api, type Member, type ServerDetail, type User } from '../lib/api'
import { memberName } from '../lib/members'
import { basePermissions, channelPermissions, has, outranks, Perm, rankOf } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { useSocial } from '../store/social'
import { getRoom, setUserAudio, useVoice } from '../store/voice'
import { CheckItem, contextMenu, copy, Item, Label, menuPoint, Separator, showDialog, SliderItem, Submenu, toast } from './ContextMenu'
import { FormError, Modal } from './Modal'
import { ConfirmModal, errorText } from './modals'
import { ProfilePopover } from './ProfileCard'
import { Field, PrimaryButton } from './ui'
import { Tip } from './Tour'
import { t } from '../lib/i18n'

/** Runs an action from a menu; failures show as a short message. */
function run(action: Promise<unknown>, done?: string): void {
  action.then(
    () => done && toast(done),
    (err) => toast(errorText(err, t('common.tryAgainError')))
  )
}

/** Right-click handler that opens a person's menu: use it wherever someone appears. */
export function userContextMenu(user: User, meId: string, serverId?: string | null): (e: MouseEvent) => void {
  return contextMenu(() => <UserContextMenu user={user} meId={meId} serverId={serverId} />)
}

/**
 * Right-click menu of a person: what the signed-in user can do with them. With `serverId`, also
 * what they can do to them in that server; items they lack permission for don't show. `before`
 * adds items of the place it was opened from (e.g. a conversation's) right under the name.
 */
export function UserContextMenu({
  user,
  meId,
  serverId,
  before
}: {
  user: User
  meId: string
  serverId?: string | null
  before?: ReactNode
}): ReactNode {
  const server = useChat((s) => (serverId ? s.servers[serverId] : undefined))
  const friend = useSocial((s) => s.friends[user.id])
  const audio = useAppearance((s) => s.settings.user_audio[user.id])
  // Their volume only matters while they're in our call (re-checked on every room change).
  const inMyCall = useVoice((s) => s.phase !== 'idle' && !!getRoom()?.remoteParticipants.has(user.id))
  const isMe = user.id === meId
  const member = server?.members.find((m) => m.user.id === user.id)
  const social = useSocial.getState()
  const isFriend = friend?.kind === 'friend'
  // @aureum takes no friend requests and can't be blocked (its DM can be silenced instead).
  const officialBot = !!user.is_official && !!user.is_bot

  const openProfile = (): void => {
    const at = menuPoint()
    showDialog((close) => <ProfilePopover user={user} anchor={at} onClose={close} />)
  }

  return (
    <>
      <Tip id="people.menu" />
      <Label>{member ? memberName(member) : user.display_name}</Label>
      {before && (
        <>
          {before}
          <Separator />
        </>
      )}
      <Item icon={UserRound} label={t('top.viewProfile')} onClick={openProfile} />
      {!isMe && isFriend && (
        <>
          <Item icon={MessageCircle} label={t('people.menu.message')} onClick={() => run(social.openDm(user.id))} />
          <Item icon={Phone} label={t('people.menu.call')} onClick={() => run(social.openDm(user.id).then(social.startCall))} />
        </>
      )}
      {!isMe && !friend && !officialBot && <Item icon={UserPlus} label={t('people.menu.addFriend')} onClick={() => run(social.sendRequest(user.username), t('people.menu.requestSent'))} />}
      {!isMe && friend?.kind === 'incoming' && <Item icon={Check} label={t('people.menu.acceptRequest')} onClick={() => run(social.accept(user.id))} />}
      {!isMe && friend?.kind === 'outgoing' && <Item icon={X} label={t('people.menu.cancelRequest')} onClick={() => run(social.remove(user.id))} />}
      {!isMe && isFriend && (
        <Item
          icon={UserMinus}
          label={t('people.menu.unfriend')}
          onClick={() =>
            showDialog((close) => (
              <ConfirmModal
                title={t('people.menu.unfriendTitle', { name: user.display_name })}
                message={t('people.menu.unfriendConfirm')}
                confirmLabel={t('people.menu.unfriend')}
                onConfirm={() => social.remove(user.id)}
                onClose={close}
              />
            ))
          }
        />
      )}

      {!isMe && (
        <>
          <Separator />
          {inMyCall && (
            <SliderItem
              label={t('people.menu.volume')}
              value={audio?.volume ?? 100}
              min={0}
              max={200}
              step={5}
              format={(v) => `${v}%`}
              onChange={(volume) => setUserAudio(user.id, { volume })}
            />
          )}
          <CheckItem label={t('people.menu.muteForMe')} checked={!!audio?.muted} onChange={() => setUserAudio(user.id, { muted: !audio?.muted })} />
        </>
      )}

      {server && member && <ServerItems server={server} member={member} meId={meId} />}

      <Separator />
      <Item icon={Copy} label={t('nav.menus.copyId')} onClick={() => copy(user.id, t('nav.menus.idCopied'))} />
      {!isMe &&
        !officialBot &&
        (friend?.kind === 'blocked' ? (
          <Item icon={Ban} label={t('people.menu.unblock')} onClick={() => run(social.unblock(user.id))} />
        ) : (
          <Item
            icon={Ban}
            label={t('people.menu.block')}
            danger
            onClick={() =>
              showDialog((close) => (
                <ConfirmModal
                  title={t('people.menu.blockTitle', { name: user.display_name })}
                  message={t('people.menu.blockConfirm')}
                  confirmLabel={t('people.menu.block')}
                  onConfirm={() => social.block(user.id)}
                  onClose={close}
                />
              ))
            }
          />
        ))}
    </>
  )
}

/** What the user can do to a member in a server: nickname, roles, voice moderation, kick and ban. */
function ServerItems({ server, member, meId }: { server: ServerDetail; member: Member; meId: string }): ReactNode {
  const user = member.user
  const isMe = user.id === meId
  const sid = server.id
  const perms = basePermissions(server, meId)
  const above = isMe || outranks(server, meId, rankOf(server, user.id))
  const voice = server.voice_states.find((v) => v.user_id === user.id)
  const room = voice ? server.channels.find((c) => c.id === voice.channel_id) : undefined
  // Voice moderation is checked in the room they're in, like the API does.
  const voicePerms = room ? channelPermissions(server, room, meId) : perms
  const canNick = isMe ? has(perms, Perm.CHANGE_NICKNAME) : has(perms, Perm.MANAGE_NICKNAMES) && above
  const roles = has(perms, Perm.MANAGE_ROLES) ? server.roles.filter((r) => r.id !== sid && outranks(server, meId, r.position)) : []
  const canMute = above && has(voicePerms, Perm.MUTE_MEMBERS)
  const canDeafen = above && has(voicePerms, Perm.DEAFEN_MEMBERS)
  const rooms =
    voice && above && has(voicePerms, Perm.MOVE_MEMBERS)
      ? server.channels.filter((c) => c.type === 'voice' && c.id !== voice.channel_id && has(channelPermissions(server, c, meId), Perm.CONNECT))
      : []
  const removable = !isMe && above && user.id !== server.owner_id
  const canKick = removable && has(perms, Perm.KICK_MEMBERS)
  const canBan = removable && has(perms, Perm.BAN_MEMBERS)
  const moderate = (body: object, done?: string): void =>
    run(api(`/servers/${sid}/members/${user.id}/voice`, { method: 'PATCH', body }), done)

  if (!canNick && !roles.length && !canMute && !canDeafen && !rooms.length && !canKick && !canBan) return null
  const name = memberName(member)
  return (
    <>
      <Separator />
      {canNick && (
        <Item
          icon={Pencil}
          label={isMe ? t('people.menu.myNickname') : t('people.menu.setNickname')}
          onClick={() => showDialog((close) => <NicknameModal server={server} member={member} onClose={close} />)}
        />
      )}
      {roles.length > 0 && (
        <Submenu icon={Shield} label={t('people.menu.roles')}>
          {roles.map((role) => {
            const holds = member.role_ids.includes(role.id)
            return (
              <CheckItem
                key={role.id}
                label={role.name}
                color={role.color}
                checked={holds}
                onChange={() =>
                  run(api(`/servers/${sid}/members/${user.id}/roles/${role.id}`, { method: holds ? 'DELETE' : 'PUT' }))
                }
              />
            )
          })}
        </Submenu>
      )}
      {canMute && (
        <CheckItem label={t('people.menu.serverMute')} checked={member.voice_muted} onChange={() => moderate({ muted: !member.voice_muted })} />
      )}
      {canDeafen && (
        <CheckItem
          label={t('people.menu.serverDeafen')}
          checked={member.voice_deafened}
          onChange={() => moderate({ deafened: !member.voice_deafened })}
        />
      )}
      {rooms.length > 0 && (
        <Submenu icon={ArrowRightLeft} label={t('people.menu.moveTo')}>
          {rooms.map((r) => (
            <Item key={r.id} icon={Volume2} label={r.name ?? ''} onClick={() => moderate({ channel_id: r.id }, `${name} foi para ${r.name}`)} />
          ))}
        </Submenu>
      )}
      {canKick && (
        <Item
          icon={UserX}
          label={t('people.menu.kickNamed', { name })}
          danger
          onClick={() =>
            showDialog((close) => (
              <ConfirmModal
                title={t('people.menu.kickNamed', { name })}
                message={t('people.menu.kickConfirm')}
                confirmLabel={t('server.members.kick')}
                onConfirm={() => api(`/servers/${sid}/members/${user.id}`, { method: 'DELETE' })}
                onClose={close}
              />
            ))
          }
        />
      )}
      {canBan && (
        <Item
          icon={Gavel}
          label={t('people.menu.banNamed', { name })}
          danger
          onClick={() =>
            showDialog((close) => (
              <ConfirmModal
                title={t('people.menu.banNamed', { name })}
                message={t('people.menu.banConfirm')}
                confirmLabel={t('server.members.ban')}
                onConfirm={() => api(`/servers/${sid}/bans/${user.id}`, { method: 'PUT', body: {} })}
                onClose={close}
              />
            ))
          }
        />
      )}
    </>
  )
}

function NicknameModal({ server, member, onClose }: { server: ServerDetail; member: Member; onClose(): void }): ReactNode {
  const [value, setValue] = useState(member.nickname ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    try {
      await api(`/servers/${server.id}/members/${member.user.id}`, { method: 'PATCH', body: { nickname: value.trim() || null } })
      onClose()
    } catch (err) {
      setError(errorText(err, t('people.menu.nicknameFailed')))
      setBusy(false)
    }
  }

  return (
    <Modal title={t('people.menu.nickname')} subtitle={t('people.menu.nicknameHint', { name: member.user.display_name, server: server.name })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field
          label={t('people.menu.nickname')}
          value={value}
          maxLength={32}
          autoFocus
          placeholder={member.user.display_name}
          hint={t('people.menu.nicknameEmpty')}
          onChange={(e) => setValue(e.target.value)}
        />
        <PrimaryButton type="submit" disabled={busy}>
          {t('common.save')}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

/** Small icon for someone the user muted locally. */
export function LocallyMuted({ userId, size = 14 }: { userId: string; size?: number }): ReactNode {
  const audio = useAppearance((s) => s.settings.user_audio[userId])
  if (!audio?.muted && (audio?.volume ?? 100) > 0) return null
  return <VolumeX size={size} aria-label={t('people.menu.mutedForYou')} className="shrink-0 text-danger" />
}
