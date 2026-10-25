import { exportToBlob, restoreElements } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { useEffect, useState, type ReactNode } from 'react'

import { FormError, Modal, SecondaryButton } from '../../components/Modal'
import { PrimaryButton } from '../../components/ui'
import { api, ApiError, type User } from '../../lib/api'
import { whiteboardPath, type BoardScene, type SceneElement } from './store'

interface Version {
  id: number
  author_id: string | null
  created_at: string
}

const when = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** The board's saved versions (one per stretch of editing): look at one, then bring it back. */
export function VersionsModal({
  channelId,
  board,
  people,
  onRestored,
  onClose
}: {
  channelId: string
  board: BoardScene
  people: Map<string, User>
  onRestored(elements: SceneElement[]): void
  onClose(): void
}): ReactNode {
  const path = whiteboardPath(channelId, `/boards/${board.id}/versions`)
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Version[]>(path)
      .then((list) => {
        setVersions(list)
        setPicked(list[0]?.id ?? null)
      })
      .catch(() => setError('Não foi possível carregar as versões.'))
  }, [path])

  useEffect(() => {
    if (picked === null) return
    let url: string | null = null
    let alive = true
    setPreview(null)
    api<{ elements: SceneElement[] }>(`${path}/${picked}`)
      .then(({ elements }) =>
        elements.length
          ? exportToBlob({
              elements: restoreElements(elements as unknown as ExcalidrawElement[], null),
              // Images aren't drawn in the preview; restoring brings them back.
              files: null,
              appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
              maxWidthOrHeight: 640
            })
          : null
      )
      .then((blob) => {
        if (alive) setPreview(blob ? (url = URL.createObjectURL(blob)) : '')
      })
      .catch(() => alive && setError('Não foi possível mostrar essa versão.'))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path, picked])

  async function restore(): Promise<void> {
    if (picked === null) return
    setBusy(true)
    setError(null)
    try {
      const restored = await api<BoardScene>(`${path}/${picked}/restore`, { method: 'POST' })
      onRestored(restored.elements)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'Você não tem permissão para editar este quadro.' : 'Não foi possível restaurar.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Versões" subtitle="Uma por trecho de edição, as 50 mais recentes." wide onClose={onClose}>
      <FormError message={error} />
      {versions && !versions.length && (
        <p className="py-8 text-center text-sm text-fg-subtle">Ainda não há versões. Elas aparecem depois de uns minutos de edição.</p>
      )}
      {!!versions?.length && (
        <div className="flex min-h-0 gap-4">
          <ul className="w-48 shrink-0 space-y-1 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setPicked(v.id)}
                  className={`w-full rounded-item px-2.5 py-1.5 text-left text-sm ${picked === v.id ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-elevated'}`}
                >
                  <span className="block font-medium">{when.format(new Date(v.created_at))}</span>
                  <span className="block truncate text-xs opacity-80">{(v.author_id && people.get(v.author_id)?.display_name) ?? 'Alguém'}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-h-64 min-w-0 flex-1 items-center justify-center rounded-control border border-line bg-main p-2">
            {preview === null ? (
              <span className="text-sm text-fg-subtle">Carregando…</span>
            ) : preview ? (
              <img src={preview} alt="Prévia da versão" className="wb-picture max-h-96 max-w-full object-contain" />
            ) : (
              <span className="text-sm text-fg-subtle">Quadro vazio nessa versão.</span>
            )}
          </div>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <div className="w-32">
          <SecondaryButton type="button" onClick={onClose}>
            Fechar
          </SecondaryButton>
        </div>
        {board.can_edit && !!versions?.length && (
          <div className="w-56">
            <PrimaryButton type="button" disabled={busy || picked === null} onClick={() => void restore()}>
              {busy ? 'Restaurando…' : 'Restaurar esta versão'}
            </PrimaryButton>
          </div>
        )}
      </div>
    </Modal>
  )
}
