import { CheckCheck, Copy, ImageMinus, ImagePlus, LogOut, Pencil, X } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Dm } from '../lib/api'
import { useChat } from '../store/chat'
import { dmPeer, dmTitle, useSocial } from '../store/social'
import { CheckItem, copy, Item, Label, Separator, showDialog, toast } from './ContextMenu'
import { ConfirmModal, errorText } from './modals'
import { toggleMuted, useMuted } from './PlaceMenus'
import { RenameGroupModal } from './socialModals'
import { UserContextMenu } from './UserMenu'

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** Picks an image and makes it the group's picture. */
function pickGroupIcon(id: string): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = IMAGE_TYPES
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) return toast('A imagem pode ter até 8 MB.')
    useSocial
      .getState()
      .setGroupIcon(id, file)
      .catch((err) => toast(errorText(err, 'Não foi possível trocar o ícone.')))
  }
  input.click()
}

/** What a conversation's right-click menu adds: read, silence, close or the group's own actions. */
function ConversationItems({ dm, meId }: { dm: Dm; meId: string }): ReactNode {
  const read = useChat((s) => s.reads[dm.id])
  const muted = useMuted(dm.id)
  const social = useSocial.getState()
  const group = dm.type === 'group_dm'
  const title = dmTitle(dm, meId)
  return (
    <>
      {read?.unread_count ? <Item icon={CheckCheck} label="Marcar como lida" onClick={() => useChat.getState().markRead(dm.id, true)} /> : null}
      <CheckItem label="Silenciar conversa" checked={muted} onChange={() => toggleMuted(dm.id)} />
      {group ? (
        <>
          <Item
            icon={Pencil}
            label="Renomear grupo"
            onClick={() => showDialog((close) => <RenameGroupModal id={dm.id} current={dm.name} onClose={close} />)}
          />
          <Item icon={ImagePlus} label="Alterar ícone" onClick={() => pickGroupIcon(dm.id)} />
          {dm.icon_url && (
            <Item
              icon={ImageMinus}
              label="Remover ícone"
              onClick={() => social.setGroupIcon(dm.id, null).catch((err) => toast(errorText(err, 'Não deu certo. Tente de novo.')))}
            />
          )}
          <Item
            icon={LogOut}
            label="Sair do grupo"
            danger
            onClick={() =>
              showDialog((close) => (
                <ConfirmModal
                  title={`Sair de ${title}`}
                  message="Você só volta se alguém do grupo te adicionar de novo."
                  confirmLabel="Sair do grupo"
                  onConfirm={() => social.closeDm(dm.id)}
                  onClose={close}
                />
              ))
            }
          />
        </>
      ) : (
        // It comes back with the next message.
        <Item icon={X} label="Fechar DM" onClick={() => social.closeDm(dm.id).catch(() => {})} />
      )}
    </>
  )
}

/** Right-click menu of a conversation in the DM list: in a 1:1, the person's menu with the
 * conversation's items on top; in a group, the group's. */
export function ConversationMenu({ dm, meId }: { dm: Dm; meId: string }): ReactNode {
  const peer = dmPeer(dm, meId)
  if (peer) return <UserContextMenu user={peer} meId={meId} before={<ConversationItems dm={dm} meId={meId} />} />
  return (
    <>
      <Label>{dmTitle(dm, meId)}</Label>
      <ConversationItems dm={dm} meId={meId} />
      <Separator />
      <Item icon={Copy} label="Copiar ID" onClick={() => copy(dm.id, 'ID copiado')} />
    </>
  )
}
