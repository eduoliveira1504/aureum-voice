import { ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, Move, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { appKey, gameApps, OVERLAY_EXCEPTIONS } from '../../../shared/overlayRule'
import type { KnownGame, OverlayCorner, OverlayPrefs } from '../../../shared/types'
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

/** Program names (see appKey) as removable chips, with the game's name when it's a known one. */
function AppChips({ apps, label, removeLabel, onRemove }: { apps: string[]; label(app: string): string; removeLabel(name: string): string; onRemove(app: string): void }): ReactNode {
  if (!apps.length) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-2">
      {apps.map((app) => (
        <li key={app} className="flex items-center gap-1 rounded-item border border-line bg-main py-1 pl-2.5 pr-1 text-sm">
          {label(app)}
          <button
            type="button"
            aria-label={removeLabel(label(app))}
            title="Remover"
            onClick={() => onRemove(app)}
            className="rounded-item p-0.5 text-fg-muted hover:bg-elevated hover:text-fg"
          >
            <X size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Picks one of the programs open right now (listed when the menu opens), except the `skip` ones. */
function OpenAppPicker({ label, empty, skip, onPick }: { label: string; empty: string; skip(app: string): boolean; onPick(app: string): void }): ReactNode {
  const [running, setRunning] = useState<string[] | null>(null)
  const choices = (running ?? []).filter((app) => !skip(app))

  const loadRunning = (): void => {
    void window.aureum.games.running().then((apps) =>
      setRunning([...new Set(apps.map((a) => appKey(a.exe)))].sort((a, b) => a.localeCompare(b)))
    )
  }

  return (
    <select
      aria-label={label}
      value=""
      onFocus={loadRunning}
      onMouseDown={() => running === null && loadRunning()}
      onChange={(e) => e.target.value && onPick(e.target.value)}
      className="w-full max-w-72 rounded-control border border-line bg-main px-3 py-2 text-sm"
    >
      <option value="">{running === null ? `${label}…` : choices.length ? 'Escolha um programa aberto…' : empty}</option>
      {choices.map((app) => (
        <option key={app} value={app}>
          {app}.exe
        </option>
      ))}
    </select>
  )
}

/** The known games, searchable, each with "Ocultar" (its programs go to the hidden list). */
function KnownGames({ known, hidden, onHide }: { known: KnownGame[]; hidden: string[]; onHide(game: KnownGame, hide: boolean): void }): ReactNode {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = known.filter((g) => g.name.toLowerCase().includes(q))
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-fg-muted hover:text-fg">Ver jogos conhecidos ({known.length})</summary>
      <input
        type="search"
        aria-label="Buscar jogo"
        placeholder="Buscar jogo…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mt-2 w-full rounded-control border border-line bg-main px-3 py-2"
      />
      <ul className="mt-2 max-h-56 overflow-y-auto rounded-control border border-line">
        {shown.map((game) => {
          const off = game.exe.every((exe) => hidden.includes(appKey(exe)))
          return (
            <li key={`${game.name}:${game.exe.join()}`} className="flex items-center justify-between gap-2 px-3 py-1.5 even:bg-main">
              <span className={`truncate ${off ? 'text-fg-subtle line-through' : ''}`}>{game.name}</span>
              <button
                type="button"
                onClick={() => onHide(game, !off)}
                className="shrink-0 rounded-item px-2 py-0.5 text-xs font-medium text-fg-muted hover:bg-elevated hover:text-fg"
              >
                {off ? 'Mostrar overlay' : 'Ocultar overlay'}
              </button>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/** "Jogos com overlay" and "Ocultar overlay neste jogo": the overlay shows only over games
 *  (see shared/overlayRule.ts), the known ones plus the ones added here. */
function OverlayGames({ prefs, set }: { prefs: OverlayPrefs; set(patch: Partial<OverlayPrefs>): void }): ReactNode {
  const [known, setKnown] = useState<KnownGame[]>([])
  useEffect(() => void window.aureum.games.known().then(setKnown), [])
  const knownApps = useMemo(() => gameApps(known, null, []), [known])
  const names = useMemo(() => new Map(known.flatMap((g) => g.exe.map((exe) => [appKey(exe), g.name] as const))), [known])
  const label = (app: string): string => names.get(app) ?? `${app}.exe`
  const isGame = (app: string): boolean => knownApps.has(app) || prefs.games.includes(app)

  const hide = (game: KnownGame, on: boolean): void => {
    const apps = game.exe.map(appKey)
    set({ hiddenApps: on ? [...new Set([...prefs.hiddenApps, ...apps])] : prefs.hiddenApps.filter((a) => !apps.includes(a)) })
  }

  return (
    <>
      <section>
        <span className={labelClass}>Jogos com overlay</span>
        <p className="mb-2 text-xs text-fg-subtle">
          O overlay só aparece sobre jogos: os conhecidos pelo Aureum, os que você adicionou em Atividade e os que você
          adicionar aqui. Launchers e clients (Steam, Riot Client, Epic etc.) nunca contam. Para isso o Aureum confere só o
          nome do programa em primeiro plano, uma vez por segundo durante a chamada; o nome não sai do seu PC.
        </p>
        <AppChips
          apps={prefs.games}
          label={label}
          removeLabel={(name) => `Remover ${name} dos jogos com overlay`}
          onRemove={(app) => set({ games: prefs.games.filter((g) => g !== app) })}
        />
        <OpenAppPicker
          label="Adicionar jogo"
          empty="Nenhum outro programa aberto"
          skip={(app) => isGame(app) || OVERLAY_EXCEPTIONS.has(app)}
          onPick={(app) => set({ games: [...prefs.games, app] })}
        />
        <KnownGames known={known} hidden={prefs.hiddenApps} onHide={hide} />
      </section>

      <section>
        <span className={labelClass}>Ocultar overlay neste jogo</span>
        <p className="mb-2 text-xs text-fg-subtle">O overlay não aparece sobre estes jogos.</p>
        <AppChips
          apps={prefs.hiddenApps}
          label={label}
          removeLabel={(name) => `Mostrar overlay de novo em ${name}`}
          onRemove={(app) => set({ hiddenApps: prefs.hiddenApps.filter((h) => h !== app) })}
        />
        <OpenAppPicker
          label="Ocultar jogo aberto"
          empty="Nenhum outro jogo aberto"
          skip={(app) => !isGame(app) || prefs.hiddenApps.includes(app)}
          onPick={(app) => set({ hiddenApps: [...prefs.hiddenApps, app] })}
        />
      </section>
    </>
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
        description="Durante uma chamada, mostra quem está nela por cima do jogo. Aparece só quando um jogo está em primeiro plano; nunca em navegadores, launchers ou outros apps."
        checked={prefs.enabled}
        onChange={(enabled) => set({ enabled })}
      />

      <OverlayGames prefs={prefs} set={set} />

      <section className="space-y-2">
        <span className={labelClass}>Atalhos (funcionam com o Aureum em segundo plano)</span>
        <ShortcutRow title="Esconder / mostrar durante a chamada" field="toggleShortcut" prefs={prefs} />
        <ShortcutRow title="Editar posição" field="editShortcut" prefs={prefs} />
        <p className="text-xs text-fg-subtle">
          Alguns jogos bloqueiam atalhos do Windows. Para funcionar neles, durante uma chamada com o overlay ligado o
          Aureum confere só as teclas desses dois atalhos. Nenhuma outra tecla é lida e nada é gravado.
        </p>
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
