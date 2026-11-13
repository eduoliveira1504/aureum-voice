import { useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, type Category, type ServerDetail } from '../lib/api'
import { PermissionsEditor, categoryAsChannel } from './ChannelSettings'
import { FormError, Modal } from './Modal'
import { Field, PrimaryButton } from './ui'
import { t } from '../lib/i18n'

function categoryError(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return t('server.forbidden')
  if (err instanceof ApiError && err.status === 404) return t('server.category.notFound')
  return t('server.category.saveFailed')
}

/** Creates a category, or renames `category`. */
export function CategoryNameModal({ serverId, category, onClose }: { serverId: string; category?: Category; onClose(): void }): ReactNode {
  const [name, setName] = useState(category?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim()) return setError(t('server.category.nameIt'))
    setBusy(true)
    try {
      if (category) await api(`/categories/${category.id}`, { method: 'PATCH', body: { name: name.trim() } })
      else await api(`/servers/${serverId}/categories`, { method: 'POST', body: { name: name.trim() } })
      onClose()
    } catch (err) {
      setError(categoryError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={category ? t('server.category.rename') : t('server.category.create')} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        <Field autoFocus label={t('server.category.name')} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={t('server.category.namePlaceholder')} />
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

/** The channel permissions editor, for a whole category. */
export function CategoryPermissionsModal({
  server,
  category,
  meId,
  onClose
}: {
  server: ServerDetail
  category: Category
  meId: string
  onClose(): void
}): ReactNode {
  return (
    <Modal title={t('server.category.perms', { name: category.name })} subtitle={t('server.category.permsHint')} wide onClose={onClose}>
      <PermissionsEditor server={server} channel={categoryAsChannel(category)} meId={meId} path={`/categories/${category.id}/overrides`} place={t('server.category.here')} />
    </Modal>
  )
}
