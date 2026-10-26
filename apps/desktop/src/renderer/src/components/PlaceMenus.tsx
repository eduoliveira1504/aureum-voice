import { ArrowDown, ArrowUp, CalendarPlus, CheckCheck, Copy, Link, LogOut, Settings, SlidersHorizontal, Trash2, UserPlus, X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

import { api, type Channel, type Invite, type ReadState, type ServerDetail } from '../lib/api'
import { basePermissions, channelActions, channelPermissions, has, Perm } from '../lib/permissions'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { ChannelSettingsModal } from './ChannelSettings'
import { CheckItem, copy, Item, Label, Separator, showDialog, toast } from './ContextMenu'
import { ConfirmModal, errorText, InviteModal } from './modals'
import { ServerSettingsModal } from './ServerSettings'

/** Silenced channels and servers (user setting): no unread badges, mentions still count. */
export function useMuted(id: string): boolean {
  return useAppearance((s) => s.settings.muted_places.includes(id))
}

export function toggleMuted(id: string): void {
  const { settings, update } = useAppearance.getState()
  const muted = settings.muted_places
  update({ muted_places: muted.includes(id) ? muted.filter((x) => x !== id) : [...muted, id] })
}

/** Creates an invite and copies its code (invites have no web link: the code is what people paste). */
function copyInvite(serverId: string): void {
  api<Invite>(`/servers/${serverId}/invites`, { method: 'POST', body: {} }).then(
    (invite) => copy(invite.code, 'Código do convite copiado'),
    (err) => toast(errorText(err, 'Não foi possível criar o convite.'))
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
  if (channel.type === 'text') return 'Todas as mensagens do canal serão apagadas.'
  if (channel.type === 'addon') return 'O addon e tudo o que foi feito nele serão apagados.'
  return 'A sala de voz será removida.'
}

export function ChannelMenu({ server, channel, meId }: { server: ServerDetail; channel: Channel; meId: string }): ReactNode {
  const read = useChat((s) => s.reads[channel.id])
  const muted = useMuted(channel.id)
  const text = channel.type === 'text'
  const { canSettings, canDelete } = channelActions(server, channel, meId)
  const label = `${text ? '#' : ''}${channel.name}`
  // Reordering without dragging (keyboard and precision): one place at a time, within the section.
  const section = server.channels.filter((c) => c.type === channel.type)
  const index = section.findIndex((c) => c.id === channel.id)
  const canMove = has(basePermissions(server, meId), Perm.MANAGE_CHANNELS) && section.length > 1
  const move = (delta: -1 | 1) => (): void => {
    useChat.getState().moveChannel(server.id, channel.id, delta).catch((err) => toast(errorText(err, 'Não foi possível mover o canal.')))
  }

  return (
    <>
      <Label>{label}</Label>
      {text && (read?.unread_count || read?.mention_count) ? (
        <Item icon={CheckCheck} label="Marcar como lido" onClick={() => useChat.getState().markRead(channel.id, true)} />
      ) : null}
      {text && <CheckItem label="Silenciar canal" checked={muted} onChange={() => toggleMuted(channel.id)} />}
      {canSettings && (
        <Item
          icon={SlidersHorizontal}
          label="Configurações do canal"
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
      {canMove && index > 0 && <Item icon={ArrowUp} label="Mover para cima" onClick={move(-1)} />}
      {canMove && index < section.length - 1 && <Item icon={ArrowDown} label="Mover para baixo" onClick={move(1)} />}
      {has(basePermissions(server, meId), Perm.CREATE_INVITE) && <Item icon={Link} label="Copiar convite" onClick={() => copyInvite(server.id)} />}
      <Separator />
      <Item icon={Copy} label="Copiar ID" onClick={() => copy(channel.id, 'ID copiado')} />
      {canDelete && (
        <Item
          icon={Trash2}
          label="Excluir canal"
          danger
          onClick={() =>
            showDialog((close) => (
              <ConfirmModal
                title={`Excluir ${label}`}
                message={deleteChannelMessage(channel)}
                confirmLabel="Excluir canal"
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
  const canSettings = has(perms, Perm.MANAGE_SERVER | Perm.MANAGE_ROLES | Perm.KICK_MEMBERS | Perm.BAN_MEMBERS | Perm.MANAGE_EXPRESSIONS)
  const canInvite = has(perms, Perm.CREATE_INVITE)
  const isOwner = server.owner_id === meId
  // "Criar evento" opens the first events channel where the user can create them.
  const eventsChannel = server.channels.find(
    (c) => c.type === 'addon' && c.addon_key === 'events' && has(channelPermissions(server, c, meId), Perm.MANAGE_EVENTS | Perm.MANAGE_ADDONS)
  )

  const markRead = (): void => {
    api<ReadState[]>(`/servers/${server.id}/read`, { method: 'POST' }).then(
      (states) => useChat.getState().mergeReads(states),
      (err) => toast(errorText(err, 'Não deu certo. Tente de novo.'))
    )
  }

  return (
    <>
      <Label>{server.name}</Label>
      {unread && <Item icon={CheckCheck} label="Marcar tudo como lido" onClick={markRead} />}
      <CheckItem label="Silenciar servidor" checked={muted} onChange={() => toggleMuted(server.id)} />
      {canSettings && (
        <Item
          icon={Settings}
          label="Configurações do servidor"
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
            label="Convidar pessoas"
            onClick={() => showDialog((close) => <InviteModal server={server} onClose={close} />)}
          />
          <Item icon={Link} label="Copiar convite" onClick={() => copyInvite(server.id)} />
        </>
      )}
      {eventsChannel && (
        <Item icon={CalendarPlus} label="Criar evento" onClick={() => useNav.getState().openAddonItem(server.id, eventsChannel.id, 'new')} />
      )}
      <Separator />
      <Item icon={Copy} label="Copiar ID" onClick={() => copy(server.id, 'ID copiado')} />
      {tabs && <Item icon={X} label="Fechar aba" onClick={() => useNav.getState().closeServerTab(server.id, tabs)} />}
      {!isOwner && (
        <Item
          icon={LogOut}
          label="Sair do servidor"
          danger
          onClick={() =>
            showDialog((close) => (
              <ConfirmModal
                title={`Sair de ${server.name}`}
                message="Você só volta com um novo convite."
                confirmLabel="Sair do servidor"
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
