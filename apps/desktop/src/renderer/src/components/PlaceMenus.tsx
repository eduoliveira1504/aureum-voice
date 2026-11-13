import { ArrowDown, ArrowUp, CalendarPlus, CheckCheck, Columns2, Copy, FolderPlus, Hash, Link, LogOut, Pencil, Puzzle, Settings, Shield, SlidersHorizontal, Trash2, UserPlus, Volume2, X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

import { api, type Category, type Channel, type Invite, type ReadState, type ServerDetail } from '../lib/api'
import { channelGroups } from '../lib/channelOrder'
import { basePermissions, channelActions, channelPermissions, has, Perm } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { channelTab, useNav } from '../store/nav'
import { CategoryNameModal, CategoryPermissionsModal } from './CategoryModals'
import { ChannelSettingsModal } from './ChannelSettings'
import { CheckItem, copy, Item, Label, Separator, showDialog, toast } from './ContextMenu'
import { ConfirmModal, CreateAddonModal, CreateChannelModal, errorText, InviteModal } from './modals'
import { ServerSettingsModal } from './ServerSettings'
import { t } from '../lib/i18n'

/** Silenced channels and servers (user setting): no unread badges, mentions still count. */
export function useMuted(id: string): boolean {
  return useAppearance((s) => s.settings.muted_places.includes(id))
}

export function toggleMuted(id: string): void {
  const { settings, update } = useAppearance.getState()
  const muted = settings.muted_places
  update({ muted_places: muted.includes(id) ? muted.filter((x) => x !== id) : [...muted, id] })
}

/** Create a text or voice channel, or add an addon, in `categoryId` (or the suggested place). */
function CreateItems({ server, meId, categoryId }: { server: ServerDetail; meId: string; categoryId?: string }): ReactNode {
  const perms = basePermissions(server, meId)
  if (!has(perms, Perm.MANAGE_CHANNELS)) return null
  return (
    <>
      <Item icon={Hash} label={t('nav.menus.createText')} onClick={() => showDialog((close) => <CreateChannelModal serverId={server.id} initialType="text" categoryId={categoryId} onClose={close} />)} />
      <Item icon={Volume2} label={t('nav.menus.createVoice')} onClick={() => showDialog((close) => <CreateChannelModal serverId={server.id} initialType="voice" categoryId={categoryId} onClose={close} />)} />
      {has(perms, Perm.MANAGE_ADDONS) && (
        <Item icon={Puzzle} label={t('nav.addAddon')} onClick={() => showDialog((close) => <CreateAddonModal serverId={server.id} categoryId={categoryId} onClose={close} />)} />
      )}
    </>
  )
}

/** Right click on the empty part of the sidebar. */
export function ChannelListMenu({ server, meId }: { server: ServerDetail; meId: string }): ReactNode {
  return (
    <>
      <CreateItems server={server} meId={meId} />
      <Item icon={FolderPlus} label={t('nav.createCategory')} onClick={() => showDialog((close) => <CategoryNameModal serverId={server.id} onClose={close} />)} />
    </>
  )
}

/** Rename, permissions, create a channel in it, delete: its channels are never deleted with it. */
export function CategoryMenu({ server, category, meId }: { server: ServerDetail; category: Category; meId: string }): ReactNode {
  const perms = basePermissions(server, meId)
  const canManage = has(perms, Perm.MANAGE_CHANNELS)
  return (
    <>
      <Label>{category.name}</Label>
      <CreateItems server={server} meId={meId} categoryId={category.id} />
      {canManage && <Item icon={Pencil} label={t('nav.menus.rename')} onClick={() => showDialog((close) => <CategoryNameModal serverId={server.id} category={category} onClose={close} />)} />}
      {has(perms, Perm.MANAGE_ROLES) && (
        <Item
          icon={Shield}
          label={t('nav.menus.permissions')}
          onClick={() =>
            showDialog((close) => (
              <LiveServer id={server.id} onClose={close}>
                {(live) => {
                  const current = live.categories?.find((c) => c.id === category.id)
                  return current ? <CategoryPermissionsModal server={live} category={current} meId={meId} onClose={close} /> : null
                }}
              </LiveServer>
            ))
          }
        />
      )}
      <Separator />
      <Item icon={Copy} label={t('nav.menus.copyId')} onClick={() => copy(category.id, t('nav.menus.idCopied'))} />
      {canManage && (
        <Item
          icon={Trash2}
          label={t('nav.menus.deleteCategory')}
          danger
          onClick={() =>
            showDialog((close) => (
              <ConfirmModal
                title={t('nav.deleteTitle', { name: category.name })}
                message={t('nav.menus.deleteCategoryConfirm')}
                confirmLabel={t('common.delete')}
                onConfirm={() => api(`/categories/${category.id}`, { method: 'DELETE' }).then(() => useChat.getState().refreshServer(server.id))}
                onClose={close}
              />
            ))
          }
        />
      )}
    </>
  )
}

/** Creates an invite and copies its code (invites have no web link: the code is what people paste). */
function copyInvite(serverId: string): void {
  api<Invite>(`/servers/${serverId}/invites`, { method: 'POST', body: {} }).then(
    (invite) => copy(invite.code, t('nav.menus.inviteCopied')),
    (err) => toast(errorText(err, t('server.invite.failed')))
  )
}

/** Settings dialogs opened from a menu follow live changes to the server (and close if it goes away). */
function LiveServer({ id, onClose, children }: { id: string; onClose(): void; children(server: ServerDetail): ReactNode }): ReactNode {
  const server = useChat((s) => s.servers[id])
  useEffect(() => {
    if (!server) onClose()
  }, [server, onClose])
  return server ? children(server) : null
}

/** What the confirmation says before a channel is deleted. */
export function deleteChannelMessage(channel: Channel): string {
  if (channel.type === 'text') return t('nav.menus.deleteText')
  if (channel.type === 'addon') return t('nav.menus.deleteAddon')
  return t('nav.menus.deleteVoice')
}

export function ChannelMenu({ server, channel, meId }: { server: ServerDetail; channel: Channel; meId: string }): ReactNode {
  const read = useChat((s) => s.reads[channel.id])
  const muted = useMuted(channel.id)
  const text = channel.type === 'text'
  const { canSettings, canDelete } = channelActions(server, channel, meId)
  const label = `${text ? '#' : ''}${channel.name}`
  // Reordering without dragging (keyboard and precision): one place at a time, within its list.
  const { loose, groups } = channelGroups(server)
  const section = groups.find((g) => g.channels.some((c) => c.id === channel.id))?.channels ?? loose
  const index = section.findIndex((c) => c.id === channel.id)
  const canMove = has(basePermissions(server, meId), Perm.MANAGE_CHANNELS) && section.length > 1
  const move = (delta: -1 | 1) => (): void => {
    useChat.getState().moveChannel(server.id, channel.id, delta).catch((err) => toast(errorText(err, t('nav.menus.moveFailed'))))
  }

  return (
    <>
      <Label>{label}</Label>
      {text && (read?.unread_count || read?.mention_count) ? (
        <Item icon={CheckCheck} label={t('nav.menus.markRead')} onClick={() => useChat.getState().markRead(channel.id, true)} />
      ) : null}
      {text && <CheckItem label={t('nav.menus.muteChannel')} checked={muted} onChange={() => toggleMuted(channel.id)} />}
      <Item icon={Columns2} label={t('nav.menus.openPanel')} onClick={() => useNav.getState().openTab(server.id, channelTab(channel.id), true)} />
      {canSettings && (
        <Item
          icon={SlidersHorizontal}
          label={t('nav.channelSettings')}
          onClick={() =>
            showDialog((close) => (
              <LiveServer id={server.id} onClose={close}>
                {(live) => {
                  const current = live.channels.find((c) => c.id === channel.id)
                  return current ? <ChannelSettingsModal server={live} channel={current} meId={meId} onClose={close} /> : null
                }}
              </LiveServer>
            ))
          }
        />
      )}
      {canMove && index > 0 && <Item icon={ArrowUp} label={t('nav.menus.moveUp')} onClick={move(-1)} />}
      {canMove && index < section.length - 1 && <Item icon={ArrowDown} label={t('nav.menus.moveDown')} onClick={move(1)} />}
      {has(basePermissions(server, meId), Perm.CREATE_INVITE) && <Item icon={Link} label={t('nav.menus.copyInvite')} onClick={() => copyInvite(server.id)} />}
      <Separator />
      <Item icon={Copy} label={t('nav.menus.copyId')} onClick={() => copy(channel.id, t('nav.menus.idCopied'))} />
      {canDelete && (
        <Item
          icon={Trash2}
          label={t('nav.deleteChannel')}
          danger
          onClick={() =>
            showDialog((close) => (
              <ConfirmModal
                title={t('nav.deleteTitle', { name: label })}
                message={deleteChannelMessage(channel)}
                confirmLabel={t('nav.deleteChannel')}
                onConfirm={() => api(`/channels/${channel.id}`, { method: 'DELETE' })}
                onClose={close}
              />
            ))
          }
        />
      )}
    </>
  )
}

/** A server's menu (its tab and its sidebar header). `tabs` enables "Fechar aba". */
export function ServerMenu({ server, meId, tabs }: { server: ServerDetail; meId: string; tabs?: string[] }): ReactNode {
  const unread = useChat((s) => server.channels.some((c) => s.reads[c.id]?.unread_count || s.reads[c.id]?.mention_count))
  const muted = useMuted(server.id)
  const perms = basePermissions(server, meId)
  const canSettings = has(perms, Perm.MANAGE_SERVER | Perm.MANAGE_ROLES | Perm.KICK_MEMBERS | Perm.BAN_MEMBERS | Perm.MANAGE_EXPRESSIONS | Perm.MANAGE_SOUNDBOARD)
  const canInvite = has(perms, Perm.CREATE_INVITE)
  const isOwner = server.owner_id === meId
  // "Criar evento" opens the first events channel where the user can create them.
  const eventsChannel = server.channels.find(
    (c) => c.type === 'addon' && c.addon_key === 'events' && has(channelPermissions(server, c, meId), Perm.MANAGE_EVENTS | Perm.MANAGE_ADDONS)
  )

  const markRead = (): void => {
    api<ReadState[]>(`/servers/${server.id}/read`, { method: 'POST' }).then(
      (states) => useChat.getState().mergeReads(states),
      (err) => toast(errorText(err, t('common.tryAgainError')))
    )
  }

  return (
    <>
      <Label>{server.name}</Label>
      {unread && <Item icon={CheckCheck} label={t('nav.menus.markAllRead')} onClick={markRead} />}
      <CheckItem label={t('nav.menus.muteServer')} checked={muted} onChange={() => toggleMuted(server.id)} />
      {canSettings && (
        <Item
          icon={Settings}
          label={t('nav.serverSettings')}
          onClick={() =>
            showDialog((close) => (
              <LiveServer id={server.id} onClose={close}>
                {(live) => <ServerSettingsModal server={live} meId={meId} onClose={close} />}
              </LiveServer>
            ))
          }
        />
      )}
      {canInvite && (
        <>
          <Item
            icon={UserPlus}
            label={t('nav.invite')}
            onClick={() => showDialog((close) => <InviteModal server={server} onClose={close} />)}
          />
          <Item icon={Link} label={t('nav.menus.copyInvite')} onClick={() => copyInvite(server.id)} />
        </>
      )}
      {eventsChannel && (
        <Item icon={CalendarPlus} label={t('nav.menus.createEvent')} onClick={() => useNav.getState().openAddonItem(server.id, eventsChannel.id, 'new')} />
      )}
      <Separator />
      <Item icon={Copy} label={t('nav.menus.copyId')} onClick={() => copy(server.id, t('nav.menus.idCopied'))} />
      {tabs && <Item icon={X} label={t('nav.menus.closeTab')} onClick={() => useNav.getState().closeServerTab(server.id, tabs)} />}
      {!isOwner && (
        <Item
          icon={LogOut}
          label={t('nav.leaveServer')}
          danger
          onClick={() =>
            showDialog((close) => (
              <ConfirmModal
                title={t('nav.leaveTitle', { name: server.name })}
                message={t('nav.leaveConfirm')}
                confirmLabel={t('nav.leaveServer')}
                onConfirm={() => api(`/servers/${server.id}/members/me`, { method: 'DELETE' })}
                onClose={close}
              />
            ))
          }
        />
      )}
    </>
  )
}
