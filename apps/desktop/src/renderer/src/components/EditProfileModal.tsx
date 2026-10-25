import { useCallback, useRef, useState, type ReactNode } from 'react'

import type { Me } from '../lib/api'
import { useNav } from '../store/nav'
import { Modal } from './Modal'
import { ConfirmModal } from './modals'
import { ProfileEditor } from './ProfileEditor'

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
      title="Descartar alterações?"
      message="Você mudou o perfil e ainda não salvou. Se sair agora, as mudanças se perdem."
      confirmLabel="Descartar"
      onConfirm={async () => {
        dirty.current = false
        pending()
      }}
      onClose={() => setPending(null)}
    />
  )
  return { setDirty, guard, dialog }
}

/** "Editar perfil" (opened from your profile card with useNav's setProfileEditor): the same
 * editor as Configurações › Meu perfil, in a modal of its own. */
export function EditProfileHost({ me }: { me: Me }): ReactNode {
  const open = useNav((s) => s.profileEditor)
  const { setDirty, guard, dialog } = useUnsavedGuard()
  if (!open) return null
  const close = (): void => guard(() => useNav.getState().setProfileEditor(false))
  return (
    <Modal title="Editar perfil" tall onClose={close}>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <ProfileEditor user={me} onDirtyChange={setDirty} />
      </div>
      {dialog}
    </Modal>
  )
}
