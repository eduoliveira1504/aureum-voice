import { AppWindow, Monitor } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { ShareSource } from '../../../shared/types'
import { describeScreen, SCREEN_MODES, type ScreenMode } from '../lib/mediaTier'
import { useVoice } from '../store/voice'
import { Modal } from './Modal'
import { PrimaryButton, Segmented, ToggleRow } from './ui'

/** The app's own picker for what to share (Electron has no built-in one on Windows). */
export function ScreenShareModal({ onClose }: { onClose(): void }): ReactNode {
  const startScreenShare = useVoice((s) => s.startScreenShare)
  const [sources, setSources] = useState<ShareSource[] | null>(null)
  const [tab, setTab] = useState<ShareSource['kind']>('screen')
  const [selected, setSelected] = useState<string | null>(null)
  const [audio, setAudio] = useState(true)
  const [hint, setHint] = useState<ScreenMode>('motion')
  // The plan's limits, from the call's token.
  const tier = useVoice((s) => s.media)
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

      <div role="radiogroup" aria-label="Qualidade" className="mt-4 grid grid-cols-2 gap-3">
        {(['detail', 'motion'] as const).map((mode) => (
          <label
            key={mode}
            className={`flex cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5 ${hint === mode ? 'border-accent bg-accent/10' : 'border-line bg-main hover:bg-elevated'}`}
          >
            <input type="radio" name="mode" checked={hint === mode} onChange={() => setHint(mode)} className="mt-1 accent-accent" />
            <span className="min-w-0">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{SCREEN_MODES[mode].label}</span>
                <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{describeScreen(tier, mode)}</span>
              </span>
              <span className="block text-xs text-fg-subtle">{SCREEN_MODES[mode].description}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3">
        <ToggleRow
          title="Compartilhar áudio"
          description="Som do PC (jogos, vídeos), sem as vozes da chamada."
          checked={audio}
          onChange={setAudio}
        />
      </div>

      <div className="mt-4">
        <PrimaryButton type="button" disabled={!selected || busy} onClick={share}>
          {busy ? 'Iniciando…' : 'Compartilhar'}
        </PrimaryButton>
      </div>
    </Modal>
  )
}
