import { useState, type FormEvent, type ReactNode } from 'react'

import { api, type Category, type ServerDetail } from '../lib/api'
import { PermissionsEditor, categoryAsChannel } from './ChannelSettings'
import { FormError, Modal } from './Modal'
import { errorText } from './modals'
import { Field, PrimaryButton } from './ui'

/** Creates a category, or renames `category`. */
export function CategoryNameModal({ serverId, category, onClose }: { serverId: string; category?: Category; onClose(): void }): ReactNode {
  const [name, setName] = useState(category?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim()) return setError('Dê um nome à categoria.')
    setBusy(true)
    try {
      if (category) await api(`/categories/${category.id}`, { method: 'PATCH', body: { name: name.trim() } })
      else await api(`/servers/${serverId}/categories`, { method: 'POST', body: { name: name.trim() } })
      onClose()
    } catch (err) {
      setError(errorText(err, 'Não foi possível salvar a categoria.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={category ? 'Renomear categoria' : 'Criar categoria'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        <Field autoFocus label="Nome da categoria" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Jogos" />
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
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
    <Modal title={`Permissões de ${category.name}`} subtitle="Os canais sincronizados seguem o que for definido aqui." wide onClose={onClose}>
      <PermissionsEditor server={server} channel={categoryAsChannel(category)} meId={meId} path={`/categories/${category.id}/overrides`} place="nesta categoria" />
    </Modal>
  )
}
