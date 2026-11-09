import type { ReactNode } from 'react'

import { ACCESS_TEXT } from '../../../shared/mediaAccess'
import { useAccessNotice } from '../lib/mediaAccess'
import { Modal } from './Modal'
import { PrimaryButton } from './ui'

/** A macOS permission is off (see lib/mediaAccess.ts): what to do, and a button to the right pane. */
export function AccessNotice(): ReactNode {
  const kind = useAccessNotice((s) => s.kind)
  if (!kind) return null
  const close = (): void => useAccessNotice.setState({ kind: null })
  const { title, body } = ACCESS_TEXT[kind]
  return (
    <Modal title={title} onClose={close}>
      <p className="mb-5 text-fg-muted">{body}</p>
      <PrimaryButton
        type="button"
        onClick={() => {
          void window.aureum.media.openSettings(kind)
          close()
        }}
      >
        Abrir Ajustes
      </PrimaryButton>
    </Modal>
  )
}
