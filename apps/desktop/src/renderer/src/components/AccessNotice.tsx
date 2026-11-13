import type { ReactNode } from 'react'

import { useAccessNotice } from '../lib/mediaAccess'
import { Modal } from './Modal'
import { PrimaryButton } from './ui'
import { t } from '../lib/i18n'

/** A macOS permission is off (see lib/mediaAccess.ts): what to do, and a button to the right pane. */
export function AccessNotice(): ReactNode {
  const kind = useAccessNotice((s) => s.kind)
  if (!kind) return null
  const close = (): void => useAccessNotice.setState({ kind: null })
  const title = t(`call.access.${kind}.title`)
  const body = t(`call.access.${kind}.body`)
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
        {t('call.access.openSettings')}
      </PrimaryButton>
    </Modal>
  )
}
