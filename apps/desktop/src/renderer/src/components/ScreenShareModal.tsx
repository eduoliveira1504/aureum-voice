import { useEffect, useState, type ReactNode } from 'react'

import type { ShareSource } from '../../../shared/types'
import { useVoice, type ScreenShareOptions } from '../store/voice'
import { Modal } from './Modal'
import { PrimaryButton } from './ui'

/** The app's own picker for what to share (Electron has no built-in one on Windows). */
export function ScreenShareModal({ onClose }: { onClose(): void }): ReactNode {
  const startScreenShare = useVoice((s) => s.startScreenShare)
  const [sources, setSources] = useState<ShareSource[] | null>(null)
  const [tab, setTab] = useState<ShareSource['kind']>('screen')
  const [selected, setSelected] = useState<string | null>(null)
  const [audio, setAudio] = useState(true)
  const [hint, setHint] = useState<ScreenShareOptions['hint']>('motion')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.aureum.screen.getSources().then((list) => {
      setSources(list)
      setSelected(list.find((s) => s.kind === 'screen')?.id ?? null)
    })
  }, [])

  const visible = sources?.filter((s) => s.kind === tab) ?? []

  async function share(): Promise<void> {
    if (!selected) return
    setBusy(true)
    await startScreenShare({ sourceId: selected, audio, hint })
    onClose()
  }

  return (
    <Modal title="Compartilhar tela" wide onClose={onClose}>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded bg-surface-0 p-1 text-sm">
        {(['screen', 'window'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded py-1.5 ${tab === k ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg'}`}
          >
            {k === 'screen' ? 'Telas' : 'Janelas'}
          </button>
        ))}
      </div>

      <div className="grid max-h-[340px] grid-cols-3 gap-3 overflow-y-auto pr-1">
        {sources === null && <p className="col-span-3 py-8 text-center text-fg-subtle">Carregando…</p>}
        {sources !== null && visible.length === 0 && (
          <p className="col-span-3 py-8 text-center text-fg-subtle">Nada para mostrar aqui.</p>
        )}
        {visible.map((source) => (
          <button
            key={source.id}
            type="button"
            title={source.name}
            onClick={() => setSelected(source.id)}
            onDoubleClick={share}
            className={`overflow-hidden rounded-md bg-surface-0 text-left ring-2 transition-shadow ${
              selected === source.id ? 'ring-accent' : 'ring-transparent hover:ring-surface-3'
            }`}
          >
            <img src={source.thumbnail} alt="" className="aspect-video w-full bg-black object-contain" />
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
              {source.icon && <img src={source.icon} alt="" className="h-4 w-4 shrink-0" />}
              <span className="truncate">{source.name}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded bg-surface-1 px-3 py-2.5">
          <span>
            <span className="block font-medium">Compartilhar áudio</span>
            <span className="block text-xs text-fg-subtle">Som do PC (jogos, vídeos), sem as vozes da chamada.</span>
          </span>
          <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} className="h-5 w-5 accent-accent" />
        </label>
        <div className="rounded bg-surface-1 px-3 py-2">
          <span className="mb-1 block font-medium">Otimizar para</span>
          <div className="flex gap-2 text-sm">
            {(
              [
                ['motion', 'Movimento (jogos)'],
                ['detail', 'Texto (nitidez)']
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="hint" checked={hint === value} onChange={() => setHint(value)} className="accent-accent" />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <PrimaryButton type="button" disabled={!selected || busy} onClick={share}>
          {busy ? 'Iniciando…' : 'Compartilhar'}
        </PrimaryButton>
      </div>
    </Modal>
  )
}
