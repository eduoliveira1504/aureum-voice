import { Play, Square, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import { loadMediaPrefs } from '../lib/mediaPrefs'
import { formatTime, moveEdge, parseTime, toMono, wavePeaks, type Selection } from '../lib/soundTrim'
import { inputClass } from './ui'
import { numberFormat } from '../lib/format'
import { t } from '../lib/i18n'

const BARS = 120
const KEY_STEP_SECONDS = 0.1
const SMALLEST_VIEW_SECONDS = 2

type SinkContext = AudioContext & { setSinkId?(id: string): Promise<void> }

/** Plays a stretch of `buffer` here, once. Returns a stop function. */
function playStretch(buffer: AudioBuffer, { start, end }: Selection, volume: number, onEnd: () => void): () => void {
  const ctx: SinkContext = new AudioContext({ sampleRate: buffer.sampleRate })
  const source = ctx.createBufferSource()
  const gain = ctx.createGain()
  source.buffer = buffer
  gain.gain.value = volume / 100
  source.connect(gain).connect(ctx.destination)
  const output = loadMediaPrefs().audioOutput
  if (output) void ctx.setSinkId?.(output).catch(() => {})
  source.onended = () => {
    void ctx.close().catch(() => {})
    onEnd()
  }
  source.start(0, start, end - start)
  return () => source.stop()
}

/** Start or end as text; it applies on leaving the field or on Enter. */
function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit(seconds: number): void }): ReactNode {
  const [text, setText] = useState<string | null>(null)
  const commit = (): void => {
    const parsed = text === null ? null : parseTime(text)
    if (parsed !== null) onCommit(parsed)
    setText(null)
  }
  return (
    <label className="flex items-center gap-1.5 text-xs text-fg-subtle">
      {label}
      <input
        aria-label={`${label} do trecho`}
        value={text ?? formatTime(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
        className={`${inputClass} h-8 w-20 px-2 py-1 text-sm`}
      />
    </label>
  )
}

/**
 * Waveform with a selection of up to 5 s, dragged by its two ends. Long sounds can be zoomed in
 * around the selection.
 */
export function SoundTrimEditor({
  buffer,
  selection,
  volume,
  onChange
}: {
  buffer: AudioBuffer
  selection: Selection
  volume: number
  onChange(selection: Selection): void
}): ReactNode {
  const { duration, sampleRate } = buffer
  const [viewSpan, setViewSpan] = useState(duration)
  const [viewStart, setViewStart] = useState(0)
  const [stopPlaying, setStopPlaying] = useState<(() => void) | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const stopRef = useRef(stopPlaying)
  stopRef.current = stopPlaying
  useEffect(() => () => stopRef.current?.(), [])

  const mono = useMemo(() => toMono(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))), [buffer])
  const peaks = useMemo(() => wavePeaks(mono, sampleRate, viewStart, viewStart + viewSpan, BARS), [mono, sampleRate, viewStart, viewSpan])

  const percent = (seconds: number): number => Math.max(0, Math.min(100, ((seconds - viewStart) / viewSpan) * 100))
  const move = (edge: 'start' | 'end', to: number): void => onChange(moveEdge(selection, edge, to, duration))

  const zoom = (factor: number): void => {
    const span = Math.max(Math.min(SMALLEST_VIEW_SECONDS, duration), Math.min(duration, viewSpan * factor))
    const middle = (selection.start + selection.end) / 2
    setViewSpan(span)
    setViewStart(Math.max(0, Math.min(duration - span, middle - span / 2)))
  }

  const drag = (edge: 'start' | 'end') => (e: PointerEvent<HTMLElement>) => {
    const box = area.current?.getBoundingClientRect()
    if (!box?.width) return
    const handle = e.currentTarget
    handle.setPointerCapture?.(e.pointerId)
    // Each move starts from the latest selection, not the one of this render.
    let latest = selection
    const follow = (ev: globalThis.PointerEvent): void => {
      latest = moveEdge(latest, edge, viewStart + ((ev.clientX - box.left) / box.width) * viewSpan, duration)
      onChange(latest)
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', follow)
      handle.removeEventListener('pointerup', up)
    }
    handle.addEventListener('pointermove', follow)
    handle.addEventListener('pointerup', up)
  }

  const nudge = (edge: 'start' | 'end') => (e: KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? -KEY_STEP_SECONDS : e.key === 'ArrowRight' ? KEY_STEP_SECONDS : 0
    if (!step) return
    e.preventDefault()
    move(edge, selection[edge] + step)
  }

  const listen = (): void => {
    if (stopPlaying) return stopPlaying()
    const stop = playStretch(buffer, selection, volume, () => setStopPlaying(null))
    setStopPlaying(() => stop)
  }

  const handle = (edge: 'start' | 'end', label: string): ReactNode => (
    <span
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 10) / 10}
      aria-valuenow={Math.round(selection[edge] * 10) / 10}
      aria-valuetext={formatTime(selection[edge])}
      onPointerDown={drag(edge)}
      onKeyDown={nudge(edge)}
      style={{ left: `${percent(selection[edge])}%` }}
      className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize touch-none rounded-item bg-accent outline-none focus-visible:ring-2 focus-visible:ring-fg"
    />
  )

  return (
    <div className="space-y-2" role="group" aria-label={t('sounds.trimEditor.area')}>
      <div ref={area} className="relative h-20 select-none overflow-hidden rounded-control border border-line bg-panel">
        <div aria-hidden className="absolute inset-0 flex items-center gap-px px-px">
          {peaks.map((peak, i) => (
            <span key={i} className="min-h-px flex-1 rounded-full bg-fg-subtle" style={{ height: `${Math.max(2, peak * 100)}%` }} />
          ))}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 bg-accent/25"
          style={{ left: `${percent(selection.start)}%`, width: `${percent(selection.end) - percent(selection.start)}%` }}
        />
        {handle('start', t('sounds.trimEditor.start'))}
        {handle('end', t('sounds.trimEditor.end'))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={listen}
          className="flex h-8 items-center gap-1.5 rounded-control border border-line px-2.5 text-sm text-fg-muted hover:text-fg"
        >
          {stopPlaying ? <Square size={14} /> : <Play size={14} />}
          {t('sounds.trimEditor.listen')}
        </button>
        <TimeField label={t('sounds.trimEditor.startShort')} value={selection.start} onCommit={(to) => move('start', to)} />
        <TimeField label={t('sounds.trimEditor.endShort')} value={selection.end} onCommit={(to) => move('end', to)} />
        <span className="text-xs text-fg-subtle">{t('sounds.trimEditor.length', { seconds: numberFormat({ maximumFractionDigits: 1 }).format(selection.end - selection.start) })}</span>
        <span className="flex-1" />
        <button type="button" title={t('sounds.trimEditor.zoomIn')} aria-label={t('sounds.trimEditor.zoomIn')} onClick={() => zoom(0.5)} className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg">
          <ZoomIn size={16} />
        </button>
        <button type="button" title={t('sounds.trimEditor.zoomOut')} aria-label={t('sounds.trimEditor.zoomOut')} onClick={() => zoom(2)} className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg">
          <ZoomOut size={16} />
        </button>
      </div>
    </div>
  )
}
