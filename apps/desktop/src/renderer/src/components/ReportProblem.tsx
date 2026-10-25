import { ImageOff } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'

import { api } from '../lib/api'
import type { AppInfo } from '../../../shared/types'
import { closeContextMenu, showDialog, toast } from './ContextMenu'
import { FormError, Modal, SecondaryButton } from './Modal'
import { errorText } from './modals'
import { cn, inputClass, labelClass, PrimaryButton } from './ui'

const MAX_DESCRIPTION = 2000

interface Snapshot {
  info: AppInfo
  logs: string
  /** The window as it looked when the report was opened (before the dialog covered it). */
  screenshot: Blob | null
}

let opening = false

/**
 * Opens "Reportar problema" (profile menu or Ctrl+Shift+R). The window is captured first, so the
 * screenshot shows what the person was looking at, not the dialog. It's only sent if they tick it.
 */
export async function openReportProblem(): Promise<void> {
  if (opening) return
  opening = true
  try {
    closeContextMenu()
    // Let menus close before the capture.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const [info, logs, png] = await Promise.all([
      window.aureum.app.info(),
      window.aureum.app.recentLogs(),
      window.aureum.window.capture().catch(() => null)
    ])
    const screenshot = png && png.length ? new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : null
    showDialog((close) => <ReportProblemModal snapshot={{ info, logs, screenshot }} onClose={close} />)
  } finally {
    opening = false
  }
}

export function ReportProblemModal({ snapshot, onClose }: { snapshot: Snapshot; onClose(): void }): ReactNode {
  const [description, setDescription] = useState('')
  // Off by default: the window may show private conversations.
  const [withScreenshot, setWithScreenshot] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = useMemo(() => (snapshot.screenshot ? URL.createObjectURL(snapshot.screenshot) : null), [snapshot.screenshot])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!description.trim()) return
    setSending(true)
    setError(null)
    const form = new FormData()
    form.append('description', description.trim())
    form.append('app_version', snapshot.info.version)
    form.append('os', snapshot.info.os)
    form.append('logs', snapshot.logs)
    if (withScreenshot && snapshot.screenshot) form.append('screenshot', snapshot.screenshot, 'janela.png')
    try {
      await api('/bug-reports', { method: 'POST', body: form })
      onClose()
      toast('Problema enviado. Obrigado!')
    } catch (err) {
      setError(errorText(err, 'Não foi possível enviar. Tente de novo.'))
      setSending(false)
    }
  }

  return (
    <Modal title="Reportar problema" subtitle="Conta o que aconteceu: o que você fez e o que esperava." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <label className="block">
          <span className={labelClass}>O que aconteceu?</span>
          <textarea
            autoFocus
            required
            rows={5}
            maxLength={MAX_DESCRIPTION}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={cn(inputClass, 'resize-none')}
          />
        </label>

        {snapshot.screenshot && (
          <div className="rounded-control border border-line bg-main p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={withScreenshot} onChange={(e) => setWithScreenshot(e.target.checked)} className="accent-accent" />
              Anexar print da janela
            </label>
            {withScreenshot && preview ? (
              <div className="mt-3">
                <p className="mb-2 text-xs text-fg-muted">
                  Confira antes de enviar: o print pode mostrar conversas privadas.
                </p>
                <img src={preview} alt="Print da janela" className="max-h-48 w-full rounded-control border border-line object-contain" />
                <button
                  type="button"
                  onClick={() => setWithScreenshot(false)}
                  className="mt-2 flex items-center gap-1.5 rounded-control px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                >
                  <ImageOff size={14} /> Remover print
                </button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-fg-subtle">Desmarcado: o print não é enviado.</p>
            )}
          </div>
        )}

        <details className="text-xs text-fg-subtle">
          <summary className="cursor-pointer select-none">
            Também vão: versão {snapshot.info.version}, {snapshot.info.os} e os últimos registros do app
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-control border border-line bg-main p-2 font-mono text-[11px]">
            {snapshot.logs || '(nenhum registro)'}
          </pre>
        </details>

        <div className="flex gap-2">
          <SecondaryButton type="button" onClick={onClose}>
            Cancelar
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={sending || !description.trim()}>
            {sending ? 'Enviando…' : 'Enviar'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}
