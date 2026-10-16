import { AppWindow, Monitor } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { ShareSource } from '../../../shared/types'
import { useVoice, type ScreenShareOptions } from '../store/voice'
import { Modal } from './Modal'
import { PrimaryButton, Segmented, ToggleRow } from './ui'

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
      <div className="mb-4">
        <Segmented<ShareSource['kind']>
          options={[
            { value: 'screen', label: 'Telas', icon: Monitor },
            { value: 'window', label: 'Janelas', icon: AppWindow }
          ]}
          value={tab}
          onChange={setTab}
        />
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
            className={`overflow-hidden rounded-control border border-line bg-main text-left ring-2 transition-shadow ${
              selected === source.id ? 'ring-accent' : 'ring-transparent hover:ring-line'
            }`}
          >
            <img src={source.thumbnail} alt="" className="aspect-video w-full bg-scrim object-contain" />
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
              {source.icon && <img src={source.icon} alt="" className="h-4 w-4 shrink-0" />}
              <span className="truncate">{source.name}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <ToggleRow
          title="Compartilhar áudio"
          description="Som do PC (jogos, vídeos), sem as vozes da chamada."
          checked={audio}
          onChange={setAudio}
        />
        <div className="rounded-control border border-line bg-main px-3 py-2">
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
