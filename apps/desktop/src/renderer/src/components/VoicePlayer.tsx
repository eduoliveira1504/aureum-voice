import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'

import type { Attachment } from '../lib/api'
import { useAttachmentUrl } from '../lib/attachments'
import { loadMediaPrefs } from '../lib/mediaPrefs'
import { formatDuration } from '../lib/voiceRecorder'

const SPEEDS = [1, 1.5, 2] as const

// One voice message plays at a time: starting another pauses this one.
let playing: HTMLAudioElement | null = null

/** A voice message: play/pause, its waveform (click to jump), time and speed (1x, 1.5x, 2x). */
export function VoicePlayer({ attachment, own }: { attachment: Attachment; own: boolean }): ReactNode {
  const { url, failed } = useAttachmentUrl(attachment)
  const audio = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setPlaying] = useState(false)
  const [position, setPosition] = useState(0) // ms
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const duration = attachment.duration_ms ?? 0
  const bars = attachment.waveform?.length ? attachment.waveform : [4]
  const progress = duration ? Math.min(1, position / duration) : 0

  useEffect(() => {
    if (!url) return
    const el = new Audio(url)
    const output = loadMediaPrefs().audioOutput
    if (output) void (el as HTMLAudioElement & { setSinkId?(id: string): Promise<void> }).setSinkId?.(output).catch(() => {})
    let frame = 0
    const follow = (): void => {
      setPosition(el.currentTime * 1000)
      frame = requestAnimationFrame(follow)
    }
    el.onplay = () => {
      if (playing && playing !== el) playing.pause()
      playing = el
      setPlaying(true)
      frame = requestAnimationFrame(follow)
    }
    el.onpause = () => {
      setPlaying(false)
      cancelAnimationFrame(frame)
      setPosition(el.currentTime * 1000)
    }
    el.onended = () => {
      el.currentTime = 0
      setPosition(0)
    }
    audio.current = el
    return () => {
      el.pause()
      cancelAnimationFrame(frame)
      if (playing === el) playing = null
      audio.current = null
    }
  }, [url])

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed
  }, [speed, url])

  const toggle = (): void => {
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play().catch(() => {})
    else el.pause()
  }

  const seek = (e: MouseEvent<HTMLDivElement>): void => {
    const el = audio.current
    if (!el || !duration) return
    const box = e.currentTarget.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    el.currentTime = (fraction * duration) / 1000
    setPosition(fraction * duration)
  }

  return (
    <div
      className={`flex w-[300px] max-w-full items-center gap-2.5 rounded-control px-2.5 py-2 ${own ? 'bg-bubble-own' : 'bg-elevated'}`}
    >
      <button
        type="button"
        disabled={!url}
        aria-label={isPlaying ? 'Pausar mensagem de voz' : 'Ouvir mensagem de voz'}
        onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
      </button>
      <div
        role="slider"
        aria-label="Posição"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(position / 1000)}
        tabIndex={-1}
        onClick={seek}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px]"
      >
        {bars.map((h, i) => (
          <span
            key={i}
            className={`min-w-[2px] flex-1 rounded-full ${(i + 0.5) / bars.length <= progress ? 'bg-accent' : 'bg-fg-subtle/50'}`}
            style={{ height: `${Math.max(8, h)}%` }}
          />
        ))}
      </div>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-fg-muted">
        {failed ? '—' : formatDuration(isPlaying || position > 0 ? position : duration)}
      </span>
      <button
        type="button"
        title="Velocidade"
        aria-label={`Velocidade ${speed}x`}
        onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
        className="w-10 shrink-0 rounded-item bg-panel/60 py-0.5 text-xs font-semibold tabular-nums text-fg-muted hover:text-fg"
      >
        {speed}x
      </button>
    </div>
  )
}
