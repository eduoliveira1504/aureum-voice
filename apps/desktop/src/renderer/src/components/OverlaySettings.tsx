import { ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, Move } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { OverlayCorner, OverlayPrefs } from '../../../shared/types'
import { setOverlayPrefs, useOverlay } from '../store/overlay'
import { labelClass, Segmented, ToggleRow } from './ui'

const CORNERS: { value: OverlayCorner; label: string; icon: typeof ArrowUpLeft }[] = [
  { value: 'top-left', label: 'Superior esquerdo', icon: ArrowUpLeft },
  { value: 'top-right', label: 'Superior direito', icon: ArrowUpRight },
  { value: 'bottom-left', label: 'Inferior esquerdo', icon: ArrowDownLeft },
  { value: 'bottom-right', label: 'Inferior direito', icon: ArrowDownRight }
]

/** "Control+Shift+F9" -> "Ctrl + Shift + F9" */
export const shortcutLabel = (accelerator: string): string => accelerator.replace('Control', 'Ctrl').split('+').join(' + ')

/** The Electron accelerator for a key press, or null while only modifiers are held. */
function acceleratorOf(e: KeyboardEvent): string | null {
  const code = e.code
  const key = /^Key[A-Z]$/.test(code)
    ? code.slice(3)
    : /^Digit[0-9]$/.test(code)
      ? code.slice(5)
      : /^(F([1-9]|1[0-9]|2[0-4])|Insert|Delete|Home|End|PageUp|PageDown)$/.test(code)
        ? code
        : null
  if (!key) return null
  return [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+')
}

function ShortcutRow({ title, field, prefs }: { title: string; field: 'toggleShortcut' | 'editShortcut'; prefs: OverlayPrefs }): ReactNode {
  const failed = useOverlay((s) => s.state?.failedShortcuts.includes(prefs[field]) ?? false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    // The current shortcuts would fire (and swallow the keys) while recording.
    void window.aureum.overlay.pauseShortcuts(true)
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false)
        return
      }
      const accelerator = acceleratorOf(e)
      if (!accelerator) return
      setRecording(false)
      void window.aureum.overlay
        .pauseShortcuts(false)
        .then(() => setOverlayPrefs({ [field]: accelerator }))
        .then(setError)
    }
    // Capture phase: before the settings modal sees Escape and closes.
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      void window.aureum.overlay.pauseShortcuts(false)
    }
  }, [recording, field])

  return (
    <div className="rounded-control border border-line bg-main px-3 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <span className="font-medium">{title}</span>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setRecording((r) => !r)
          }}
          className={`min-w-40 rounded-control border px-3 py-1.5 text-sm font-medium tabular-nums ${
            recording ? 'border-accent text-accent-text' : 'border-line bg-elevated hover:border-fg-subtle'
          }`}
        >
          {recording ? 'Pressione as teclas…' : shortcutLabel(prefs[field])}
        </button>
      </div>
      {recording && <p className="mt-1.5 text-xs text-fg-subtle">Ex.: Ctrl + Shift + F9. Esc cancela.</p>}
      {(error || failed) && (
        <p className="mt-1.5 text-xs text-danger">{error ?? 'Outro programa já usa esse atalho, então ele não funciona. Escolha outro.'}</p>
      )}
    </div>
  )
}

/** Settings > Overlay: the in-game overlay. Saved on this PC only (its position depends on the monitors). */
export function OverlaySettings(): ReactNode {
  const state = useOverlay((s) => s.state)
  if (!state) return null
  const { prefs } = state
  const set = (patch: Partial<OverlayPrefs>): void => void setOverlayPrefs(patch)

  return (
    <div className="max-w-[480px] space-y-4">
      <ToggleRow
        title="Mostrar overlay em jogos"
        description="Durante uma chamada, mostra quem está nela por cima de outras janelas. Some quando o Aureum está em primeiro plano."
        checked={prefs.enabled}
        onChange={(enabled) => set({ enabled })}
      />

      <section className="space-y-2">
        <span className={labelClass}>Atalhos (funcionam com o Aureum em segundo plano)</span>
        <ShortcutRow title="Mostrar / esconder" field="toggleShortcut" prefs={prefs} />
        <ShortcutRow title="Editar posição" field="editShortcut" prefs={prefs} />
      </section>

      <section>
        <span className={labelClass}>Posição</span>
        <div className="flex flex-wrap items-center gap-2">
          {CORNERS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => void window.aureum.overlay.snap(value)}
              className="rounded-control border border-line bg-main p-2 text-fg-muted hover:border-fg-subtle hover:text-fg"
            >
              <Icon size={18} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => void window.aureum.overlay.setEditing(true)}
            className="flex items-center gap-2 rounded-control border border-line bg-main px-3 py-2 text-sm font-medium hover:border-fg-subtle"
          >
            <Move size={16} />
            Editar posição e tamanho
          </button>
        </div>
        <p className="mt-1.5 text-xs text-fg-subtle">
          No modo edição, arraste o overlay para mover e puxe o canto para redimensionar. Esc ou Concluir salva a posição.
        </p>
      </section>

      <section>
        <span className={labelClass}>Tamanho</span>
        <Segmented
          options={[
            { value: 'small', label: 'Pequeno' },
            { value: 'medium', label: 'Médio' },
            { value: 'large', label: 'Grande' }
          ]}
          value={prefs.size}
          onChange={(size) => set({ size })}
        />
      </section>

      <section>
        <label htmlFor="overlay-opacity" className={labelClass}>
          Opacidade
        </label>
        <div className="flex items-center gap-3">
          <input
            id="overlay-opacity"
            type="range"
            min={30}
            max={100}
            step={5}
            value={prefs.opacity}
            onChange={(e) => set({ opacity: Number(e.target.value) })}
            className="flex-1 accent-accent"
          />
          <span className="w-10 text-right text-sm tabular-nums text-fg-muted">{prefs.opacity}%</span>
        </div>
      </section>

      <ToggleRow
        title="Mostrar câmeras"
        description="Câmeras ligadas aparecem em miniatura, incluindo a sua."
        checked={prefs.showCameras}
        onChange={(showCameras) => set({ showCameras })}
      />
      <ToggleRow
        title="Mostrar só quem está falando"
        description="Esconde quem está em silêncio; a pessoa some pouco depois de parar de falar."
        checked={prefs.onlySpeaking}
        onChange={(onlySpeaking) => set({ onlySpeaking })}
      />

      <p className="text-xs text-fg-subtle">
        Funciona com jogos em modo janela ou janela sem borda. Em tela cheia exclusiva o Windows não deixa outras janelas
        aparecerem por cima. O Aureum não mexe no jogo (nada de injeção), e o overlay não aparece em capturas nem quando
        você compartilha a tela.
      </p>
    </div>
  )
}
