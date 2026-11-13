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
import { t } from '../lib/i18n'

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
    if (file.size > MAX_IMAGE_BYTES) return toast(t('chat.conversation.imageSize'))
    useSocial
      .getState()
      .setGroupIcon(id, file)
      .catch((err) => toast(errorText(err, t('chat.conversation.iconFailed'))))
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
      {read?.unread_count ? <Item icon={CheckCheck} label={t('chat.conversation.markRead')} onClick={() => useChat.getState().markRead(dm.id, true)} /> : null}
      <CheckItem label={t('chat.conversation.mute')} checked={muted} onChange={() => toggleMuted(dm.id)} />
      {group ? (
        <>
          <Item
            icon={Pencil}
            label={t('chat.dm.rename')}
            onClick={() => showDialog((close) => <RenameGroupModal id={dm.id} current={dm.name} onClose={close} />)}
          />
          <Item icon={ImagePlus} label={t('chat.conversation.changeIcon')} onClick={() => pickGroupIcon(dm.id)} />
          {dm.icon_url && (
            <Item
              icon={ImageMinus}
              label={t('chat.conversation.removeIcon')}
              onClick={() => social.setGroupIcon(dm.id, null).catch((err) => toast(errorText(err, t('common.tryAgainError'))))}
            />
          )}
          <Item
            icon={LogOut}
            label={t('chat.dm.leave')}
            danger
            onClick={() =>
              showDialog((close) => (
                <ConfirmModal
                  title={t('chat.dm.leaveTitle', { name: title })}
                  message={t('chat.dm.leaveConfirm')}
                  confirmLabel={t('chat.dm.leave')}
                  onConfirm={() => social.closeDm(dm.id)}
                  onClose={close}
                />
              ))
            }
          />
        </>
      ) : (
        // It comes back with the next message.
        <Item icon={X} label={t('chat.conversation.close')} onClick={() => social.closeDm(dm.id).catch(() => {})} />
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
      <Item icon={Copy} label={t('chat.conversation.copyId')} onClick={() => copy(dm.id, t('chat.conversation.idCopied'))} />
    </>
  )
}
