import { Check, Hash, Monitor, Moon, Pipette, Sun } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { Theme } from '../lib/api'
import { ACCENT_PRESETS, endAccentPreview, previewAccent, useAppearance } from '../store/appearance'
import { inputClass, labelClass, Segmented } from './ui'

const HEX_RE = /^#[0-9a-f]{6}$/i

const THEMES = [
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'system', label: 'Sistema', icon: Monitor }
] as const satisfies readonly { value: Theme; label: string; icon: unknown }[]

/** Settings > Appearance. Every change applies to the whole app at once and syncs to the server. */
export function AppearanceSettings(): ReactNode {
  const { theme, accent_color: accent } = useAppearance((s) => s.settings)
  const saveError = useAppearance((s) => s.saveError)
  const update = useAppearance((s) => s.update)
  const [hex, setHex] = useState(accent)
  const isPreset = ACCENT_PRESETS.some((p) => p.hex === accent.toUpperCase())

  // Follow changes made elsewhere (presets, picker, another device).
  useEffect(() => setHex(accent), [accent])

  return (
    <div className="grid grid-cols-[1fr_280px] gap-6">
      <div className="space-y-6">
        {saveError && (
          <p role="alert" className="rounded-control border border-danger/50 bg-danger/10 px-3 py-2 text-sm">
            Não foi possível salvar no servidor. A mudança vale só neste PC por enquanto.
          </p>
        )}

        <section>
          <span className={labelClass}>Tema</span>
          <Segmented options={THEMES} value={theme} onChange={(t) => update({ theme: t })} />
          {theme === 'system' && <p className="mt-1.5 text-xs text-fg-subtle">Segue o modo claro/escuro do Windows.</p>}
        </section>

        <section>
          <span className={labelClass}>Cor de destaque</span>
          <div className="flex flex-wrap gap-3">
            {ACCENT_PRESETS.map(({ name, hex: preset }) => {
              const selected = accent.toUpperCase() === preset
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update({ accent_color: preset })}
                  className="flex w-16 flex-col items-center gap-1.5 text-xs text-fg-muted hover:text-fg"
                >
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-full ring-offset-2 ring-offset-panel ${selected ? 'ring-2 ring-fg' : ''}`}
                    style={{ background: preset }}
                  >
                    {selected && <Check size={18} className="text-on-accent" />}
                  </span>
                  {name}
                </button>
              )
            })}
            <label className="flex w-16 cursor-pointer flex-col items-center gap-1.5 text-xs text-fg-muted hover:text-fg">
              <span
                className={`relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full ring-offset-2 ring-offset-panel ${
                  isPreset ? 'border border-dashed border-line' : 'bg-accent text-on-accent ring-2 ring-fg'
                }`}
              >
                <Pipette size={18} />
                <AccentPicker accent={accent} />
              </span>
              Outra
            </label>
          </div>

          <label className="mt-4 block w-40">
            <span className="mb-1 block text-xs text-fg-subtle">Código hex</span>
            <input
              value={hex}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => {
                const value = e.target.value.trim()
                setHex(value)
                if (HEX_RE.test(value)) update({ accent_color: value.toUpperCase() })
              }}
              onBlur={() => setHex(accent)}
              className={`${inputClass} font-mono uppercase`}
            />
          </label>
          <p className="mt-2 text-xs text-fg-subtle">
            O texto sobre a cor e os links ajustam o contraste sozinhos para continuarem legíveis.
          </p>
        </section>
      </div>

      <div>
        <span className={labelClass}>Prévia</span>
        <ThemePreview />
      </div>
    </div>
  )
}

/**
 * The free color picker. Dragging fires "input" many times a second: those only repaint the accent
 * (previewAccent, no React state). The color is applied and saved once, on "change" (picker
 * released or closed). Uncontrolled, so React never resets the value mid-drag.
 */
function AccentPicker({ accent }: { accent: string }): ReactNode {
  const ref = useRef<HTMLInputElement>(null)
  const update = useAppearance((s) => s.update)

  useEffect(() => {
    if (ref.current) ref.current.value = accent.toLowerCase()
  }, [accent])

  useEffect(() => {
    const input = ref.current
    if (!input) return
    const onInput = (): void => previewAccent(input.value.toUpperCase())
    const onChange = (): void => {
      const chosen = input.value.toUpperCase()
      if (chosen !== useAppearance.getState().settings.accent_color.toUpperCase()) update({ accent_color: chosen })
      endAccentPreview() // same color as before: nothing to save, just drop the preview
    }
    input.addEventListener('input', onInput)
    input.addEventListener('change', onChange)
    input.addEventListener('blur', endAccentPreview)
    return () => {
      input.removeEventListener('input', onInput)
      input.removeEventListener('change', onChange)
      input.removeEventListener('blur', endAccentPreview)
    }
  }, [update])

  return (
    <input
      ref={ref}
      type="color"
      aria-label="Escolher outra cor"
      defaultValue={accent.toLowerCase()}
      className="absolute inset-0 cursor-pointer opacity-0"
    />
  )
}

/** A miniature of the app shell, drawn with the same tokens, so it always matches the live theme. */
function ThemePreview(): ReactNode {
  return (
    <div aria-hidden className="flex h-[220px] overflow-hidden rounded-panel border border-line bg-rail text-[11px]">
      <div className="flex w-10 flex-col items-center gap-2 py-3">
        <span className="h-7 w-7 rounded-item bg-accent ring-2 ring-accent ring-offset-2 ring-offset-rail" />
        <span className="h-7 w-7 rounded-item bg-elevated" />
      </div>
      <div className="w-20 space-y-1 bg-panel p-2">
        <div className="mb-2 h-2 w-12 rounded-full bg-line" />
        <div className="flex items-center gap-1 rounded-item bg-elevated px-1.5 py-1 text-fg">
          <Hash size={11} /> geral
        </div>
        <div className="flex items-center gap-1 px-1.5 py-1 text-fg-muted">
          <Hash size={11} /> jogos
        </div>
      </div>
      <div className="flex flex-1 flex-col bg-main p-2.5">
        <div className="flex gap-2">
          <span className="h-6 w-6 shrink-0 rounded-full bg-accent" />
          <div className="min-w-0">
            <div className="font-semibold text-fg">Aureum</div>
            <p className="text-fg-muted">
              Bora de call? <span className="text-accent-text underline">link</span>
            </p>
          </div>
        </div>
        <div className="mt-auto space-y-2">
          <div className="flex gap-1.5">
            <span className="rounded-item bg-accent px-2 py-1 font-semibold text-on-accent">Entrar</span>
            <span className="rounded-item bg-elevated px-2 py-1 text-fg">Depois</span>
          </div>
          <div className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" />
            <span className="h-2 w-2 rounded-full bg-idle" />
            <span className="h-2 w-2 rounded-full bg-dnd" />
          </div>
          <div className="rounded-item border border-line bg-elevated px-2 py-1.5 text-fg-subtle">Conversar em #geral</div>
        </div>
      </div>
    </div>
  )
}
