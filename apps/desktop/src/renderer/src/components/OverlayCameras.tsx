/** Settings of the overlay's cameras widget, and its live preview (Settings > Overlay > Câmeras). */
import { Columns3, Grid2x2, Rows3 } from 'lucide-react'
import type { ReactNode } from 'react'

import { CAMERA_LIMITS, CAMERA_SIZES, cameraLayout } from '../../../shared/overlayWidgets'
import type { OverlayCameraLayout, OverlayCameraPrefs, OverlaySize } from '../../../shared/types'
import { CameraCard, CameraTiles, type Person } from './OverlayWidgets'
import { labelClass, Segmented, ToggleRow } from './ui'

export const CAMERA_LAYOUTS = [
  { value: 'vertical', label: 'Vertical', icon: Rows3 },
  { value: 'horizontal', label: 'Horizontal', icon: Columns3 },
  { value: 'grid', label: 'Grade', icon: Grid2x2 }
] as const satisfies readonly { value: OverlayCameraLayout; label: string; icon: unknown }[]

const SIZE_OPTIONS: { value: OverlaySize; label: string }[] = [
  { value: 'small', label: 'Pequeno' },
  { value: 'medium', label: 'Médio' },
  { value: 'large', label: 'Grande' }
]

/** A labeled slider with its value next to it. */
function RangeRow({
  id,
  label,
  value,
  limits,
  unit = '',
  onChange
}: {
  id: string
  label: string
  value: number
  limits: { min: number; max: number }
  unit?: string
  onChange(value: number): void
}): ReactNode {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={limits.min}
          max={limits.max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-accent"
        />
        <span className="w-14 text-right text-sm tabular-nums text-fg-muted">
          {value}
          {unit}
        </span>
      </div>
    </div>
  )
}

/** Format, size, how many show, and spacing. `set` gets only what changed. */
export function CameraControls({ prefs, set }: { prefs: OverlayCameraPrefs; set(patch: Partial<OverlayCameraPrefs & { size: OverlaySize }>): void }): ReactNode {
  // A width that isn't one of the shortcuts selects none of them.
  const shortcut = SIZE_OPTIONS.find((o) => CAMERA_SIZES[o.value] === prefs.tileWidth)?.value ?? 'custom'
  return (
    <>
      <div>
        <span className={labelClass}>Formato</span>
        <Segmented options={CAMERA_LAYOUTS} value={prefs.layout} onChange={(layout) => set({ layout })} />
      </div>
      <div>
        <span className={labelClass}>Tamanho das câmeras</span>
        <Segmented<OverlaySize | 'custom'>
          options={SIZE_OPTIONS}
          value={shortcut}
          onChange={(size) => size !== 'custom' && set({ size })}
        />
        <div className="mt-2">
          <RangeRow
            id="overlay-camera-width"
            label="Largura de cada câmera"
            value={prefs.tileWidth}
            limits={CAMERA_LIMITS.tileWidth}
            unit=" px"
            onChange={(tileWidth) => set({ tileWidth })}
          />
        </div>
      </div>
      <RangeRow
        id="overlay-camera-count"
        label="Câmeras visíveis no máximo"
        value={prefs.maxVisible}
        limits={CAMERA_LIMITS.maxVisible}
        onChange={(maxVisible) => set({ maxVisible })}
      />
      {prefs.layout === 'grid' && (
        <RangeRow
          id="overlay-camera-per-row"
          label="Câmeras por linha"
          value={prefs.perRow}
          limits={CAMERA_LIMITS.perRow}
          onChange={(perRow) => set({ perRow })}
        />
      )}
      <p className="text-xs text-fg-subtle">
        Passou do máximo, a última câmera mostra “+N”. Quem está falando sempre aparece. A caixa do widget cresce e
        encolhe com as câmeras, a partir do canto da tela em que ela está.
      </p>
      <RangeRow
        id="overlay-camera-gap"
        label="Espaço entre as câmeras"
        value={prefs.gap}
        limits={CAMERA_LIMITS.gap}
        unit=" px"
        onChange={(gap) => set({ gap })}
      />
      <ToggleRow
        title="Cantos arredondados"
        description="Desligado, as câmeras ficam retas."
        checked={prefs.rounded}
        onChange={(rounded) => set({ rounded })}
      />
    </>
  )
}

const SAMPLE_NAMES = ['Ana', 'Beto', 'Caio', 'Duda', 'Edu', 'Fê', 'Gabi', 'Hugo']
const samplePerson = (name: string, i: number): Person => ({
  id: `sample-${i}`,
  name,
  avatarUrl: null,
  speaking: i === 0,
  muted: i === 1,
  deafened: false
})

/** Room the preview has in the settings column; bigger boxes are drawn smaller, to scale. */
const PREVIEW_ROOM = { width: 420, height: 280 }

/** The widget as it looks with the most cameras that show, drawn to scale when it's too big. */
export function CamerasPreview({ prefs }: { prefs: OverlayCameraPrefs }): ReactNode {
  const people = SAMPLE_NAMES.slice(0, prefs.maxVisible).map(samplePerson)
  const layout = cameraLayout(prefs, people.length, false)
  const scale = Math.min(1, PREVIEW_ROOM.width / layout.width, PREVIEW_ROOM.height / layout.height)
  return (
    <div>
      <div data-testid="overlay-camera-box" style={{ width: layout.width * scale, height: layout.height * scale }}>
        <div className="origin-top-left p-2" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
          <CameraTiles columns={layout.columns} tileWidth={layout.tileWidth} gap={prefs.gap}>
            {people.map((p) => (
              <CameraCard key={p.id} person={p} width={layout.tileWidth} rounded={prefs.rounded} />
            ))}
          </CameraTiles>
        </div>
      </div>
      <p className="mt-2 text-xs text-on-scrim/80">
        {people.length === 1 ? '1 câmera' : `${people.length} câmeras`} · {layout.width} × {layout.height} px
        {scale < 1 && ` · prévia em ${Math.round(scale * 100)}%`}
      </p>
    </div>
  )
}
