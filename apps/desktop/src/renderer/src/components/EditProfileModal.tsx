import { ArrowLeft, UserCog } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'

import type { Me } from '../lib/api'
import { useNav } from '../store/nav'
import { AccountSettings } from './AccountSettings'
import { Modal } from './Modal'
import { ConfirmModal } from './modals'
import { ProfileEditor } from './ProfileEditor'
import { t } from '../lib/i18n'

/**
 * Asks before leaving a form with changes that weren't saved. `guard(leave)` runs `leave` right
 * away when nothing changed, otherwise after "Descartar"; `dialog` goes in the tree.
 */
export function useUnsavedGuard(): { setDirty(dirty: boolean): void; guard(leave: () => void): void; dialog: ReactNode } {
  const dirty = useRef(false)
  const [pending, setPending] = useState<(() => void) | null>(null)
  const setDirty = useCallback((value: boolean) => void (dirty.current = value), [])
  const guard = useCallback((leave: () => void) => (dirty.current ? setPending(() => leave) : leave()), [])
  const dialog = pending && (
    <ConfirmModal
      title={t('profile.edit.discardTitle')}
      message={t('profile.edit.discardConfirm')}
      confirmLabel={t('profile.edit.discard')}
      onConfirm={async () => {
        dirty.current = false
        pending()
      }}
      onClose={() => setPending(null)}
    />
  )
  return { setDirty, guard, dialog }
}

/** "Editar perfil" (opened from your profile card with useNav's setProfileEditor), the only place
 * for the profile; its "Conta" button opens the account (e-mail and password) in the same modal. */
export function EditProfileHost({ me }: { me: Me }): ReactNode {
  const open = useNav((s) => s.profileEditor)
  const { setDirty, guard, dialog } = useUnsavedGuard()
  const [account, setAccount] = useState(false)
  if (!open) return null
  const close = (): void =>
    guard(() => {
      setAccount(false)
      useNav.getState().setProfileEditor(false)
    })
  const switchButton = 'flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg'
  return (
    <Modal title={account ? t('profile.edit.account') : t('profile.edit.title')} tall onClose={close}>
      <div className="mb-3 mt-3 flex shrink-0 justify-end">
        {account ? (
          <button type="button" onClick={() => setAccount(false)} className={switchButton}>
            <ArrowLeft size={16} /> {t('profile.edit.back')}
          </button>
        ) : (
          <button type="button" onClick={() => guard(() => setAccount(true))} className={switchButton}>
            <UserCog size={16} /> {t('profile.edit.account')}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {account ? <AccountSettings user={me} /> : <ProfileEditor user={me} onDirtyChange={setDirty} />}
      </div>
      {dialog}
    </Modal>
  )
}
