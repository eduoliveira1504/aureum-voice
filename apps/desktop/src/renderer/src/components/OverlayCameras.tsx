/** Settings of the overlay's cameras widget, and its live preview (Settings > Overlay > Câmeras). */
import { Columns3, Grid2x2, Minus, Plus, Rows3 } from 'lucide-react'
import type { ReactNode } from 'react'

import { CAMERA_LIMITS, CAMERA_SIZES, cameraLayout } from '../../../shared/overlayWidgets'
import type { OverlayCameraLayout, OverlayCameraPrefs, OverlaySize } from '../../../shared/types'
import { CameraCard, CameraTiles, type Person } from './OverlayWidgets'
import { labelClass, Segmented, ToggleRow } from './ui'
import { t } from '../lib/i18n'

export const CAMERA_LAYOUTS = [
  { value: 'vertical', icon: Rows3 },
  { value: 'horizontal', icon: Columns3 },
  { value: 'grid', icon: Grid2x2 }
] as const satisfies readonly { value: OverlayCameraLayout; icon: unknown }[]

const SIZES: readonly OverlaySize[] = ['small', 'medium', 'large']

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
  const shortcut = SIZES.find((size) => CAMERA_SIZES[size] === prefs.tileWidth) ?? 'custom'
  return (
    <>
      <div>
        <span className={labelClass}>{t('overlay.cameras.layout')}</span>
        <Segmented
          options={CAMERA_LAYOUTS.map((option) => ({ ...option, label: t(`overlay.layouts.${option.value}`) }))}
          value={prefs.layout}
          onChange={(layout) => set({ layout })}
        />
      </div>
      <div>
        <span className={labelClass}>{t('overlay.cameras.size')}</span>
        <Segmented<OverlaySize | 'custom'>
          options={SIZES.map((value) => ({ value, label: t(`overlay.sizes.${value}`) }))}
          value={shortcut}
          onChange={(size) => size !== 'custom' && set({ size })}
        />
        <div className="mt-2">
          <RangeRow
            id="overlay-camera-width"
            label={t('overlay.cameras.width')}
            value={prefs.tileWidth}
            limits={CAMERA_LIMITS.tileWidth}
            unit=" px"
            onChange={(tileWidth) => set({ tileWidth })}
          />
        </div>
      </div>
      <RangeRow
        id="overlay-camera-count"
        label={t('overlay.cameras.max')}
        value={prefs.maxVisible}
        limits={CAMERA_LIMITS.maxVisible}
        onChange={(maxVisible) => set({ maxVisible })}
      />
      {prefs.layout === 'grid' && (
        <RangeRow
          id="overlay-camera-per-row"
          label={t('overlay.cameras.perRow')}
          value={prefs.perRow}
          limits={CAMERA_LIMITS.perRow}
          onChange={(perRow) => set({ perRow })}
        />
      )}
      <p className="text-xs text-fg-subtle">
        {t('overlay.cameras.overflowHint')}
      </p>
      <RangeRow
        id="overlay-camera-gap"
        label={t('overlay.cameras.gap')}
        value={prefs.gap}
        limits={CAMERA_LIMITS.gap}
        unit=" px"
        onChange={(gap) => set({ gap })}
      />
      <ToggleRow
        title={t('overlay.cameras.rounded')}
        description={t('overlay.cameras.roundedHint')}
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
        {t('overlay.cameras.count', { count: people.length })} · {layout.width} × {layout.height} px
        {scale < 1 && t('overlay.cameras.previewAt', { percent: Math.round(scale * 100) })}
      </p>
    </div>
  )
}

/** − N + for one number of the cameras, in the edit bar. */
function Stepper({
  label,
  value,
  limits,
  onChange
}: {
  label: string
  value: number
  limits: { min: number; max: number }
  onChange(value: number): void
}): ReactNode {
  const button = 'rounded-item p-0.5 text-fg-muted hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <span role="group" aria-label={label} title={label} className="flex items-center">
      <button type="button" aria-label={t('overlay.cameras.less', { label })} disabled={value <= limits.min} onClick={() => onChange(value - 1)} className={button}>
        <Minus size={13} />
      </button>
      <span className="w-4 text-center font-semibold tabular-nums">{value}</span>
      <button type="button" aria-label={t('overlay.cameras.more', { label })} disabled={value >= limits.max} onClick={() => onChange(value + 1)} className={button}>
        <Plus size={13} />
      </button>
    </span>
  )
}

/** Edit mode (Ctrl+Shift+F10): format and how many show, on the widget's own bar. */
export function CameraEditBar({ prefs, set }: { prefs: OverlayCameraPrefs; set(patch: Partial<OverlayCameraPrefs>): void }): ReactNode {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {CAMERA_LAYOUTS.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          title={t(`overlay.layouts.${value}`)}
          aria-label={t('overlay.cameras.layoutNamed', { layout: t(`overlay.layouts.${value}`) })}
          aria-pressed={prefs.layout === value}
          onClick={() => set({ layout: value })}
          className={`rounded-item p-1 ${prefs.layout === value ? 'bg-elevated text-fg' : 'text-fg-muted hover:text-fg'}`}
        >
          <Icon size={14} />
        </button>
      ))}
      <span aria-hidden className="mx-0.5 h-4 w-px bg-line" />
      <Stepper label={t('overlay.cameras.visible')} value={prefs.maxVisible} limits={CAMERA_LIMITS.maxVisible} onChange={(maxVisible) => set({ maxVisible })} />
      {prefs.layout === 'grid' && (
        <Stepper label={t('overlay.cameras.perRowShort')} value={prefs.perRow} limits={CAMERA_LIMITS.perRow} onChange={(perRow) => set({ perRow })} />
      )}
    </span>
  )
}

/**
 * The width a drag of the edit handle gives the cameras: the pointer moved `grow` px away from the
 * box's pinned corner, shared by the columns (across) or the rows (down), whichever moved more.
 */
export function tileWidthAfterDrag(start: number, grow: { x: number; y: number }, columns: number, rows: number): number {
  const across = grow.x / columns
  const down = ((grow.y / rows) * 16) / 9
  const change = Math.abs(across) >= Math.abs(down) ? across : down
  const { min, max } = CAMERA_LIMITS.tileWidth
  return Math.round(Math.min(max, Math.max(min, start + change)))
}
