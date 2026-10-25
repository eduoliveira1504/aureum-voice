import { AudioLines, ChevronUp, Keyboard, Settings } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { GATE_RANGE, loadMediaPrefs, saveMediaPrefs, VOLUME_RANGE, type MediaPrefs } from '../lib/mediaPrefs'
import { useDevices, watchDevices } from '../store/devices'
import { cameraTrackOf, getRoom, useVoice, type DeviceKind } from '../store/voice'
import { SettingsModal } from './SettingsModal'
import { labelClass, menuClass, Segmented } from './ui'

export type DeviceMenuKind = 'mic' | 'output' | 'camera'

const TITLE: Record<DeviceMenuKind, string> = {
  mic: 'Opções do microfone',
  output: 'Opções do áudio',
  camera: 'Opções da câmera'
}

const WIDTH = 288 // w-72
const GAP = 8

/**
 * The little arrow next to the mic, headphone and camera buttons of a call. It opens a popover to
 * change the device (without leaving the call), the volume and, for the mic, the input mode and
 * sensitivity. Rendered in a portal with a fixed position, so it fits the call bar, the call card
 * and the floating window alike, above the call in fullscreen too.
 */
export function DeviceArrow({
  kind,
  small = false,
  onOpenChange
}: {
  kind: DeviceMenuKind
  /** The call card and the floating window: a smaller arrow. */
  small?: boolean
  onOpenChange?(open: boolean): void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  const toggle = (next: boolean): void => {
    setOpen(next)
    onOpenChange?.(next)
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        title={TITLE[kind]}
        aria-label={TITLE[kind]}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => toggle(!open)}
        className={
          small
            ? 'rounded-item p-0.5 text-fg-subtle hover:bg-elevated hover:text-fg'
            : '-ml-3 flex h-5 w-5 items-center justify-center self-end rounded-full border border-line bg-panel text-fg-muted hover:text-fg'
        }
      >
        <ChevronUp size={small ? 12 : 14} />
      </button>
      {open && (
        <Popover
          anchor={button}
          label={TITLE[kind]}
          onClose={() => toggle(false)}
          onSettings={() => {
            toggle(false)
            setSettings(true)
          }}
        >
          {kind === 'mic' ? <MicOptions /> : kind === 'output' ? <OutputOptions /> : <CameraOptions />}
        </Popover>
      )}
      {settings && (
        <Detached>
          <SettingsModal initialTab="voice" onClose={() => setSettings(false)} />
        </Detached>
      )}
    </>
  )
}

/**
 * Renders into document.body. React events still bubble to the arrow's ancestors through a portal,
 * so they stop here: a click in the popover must not drag the floating window or focus a tile.
 */
function Detached({ children }: { children: ReactNode }): ReactNode {
  const stop = (e: { stopPropagation(): void }): void => e.stopPropagation()
  return createPortal(
    <div onPointerDown={stop} onMouseDown={stop} onClick={stop} onDoubleClick={stop} onContextMenu={stop}>
      {children}
    </div>,
    document.body
  )
}

/** Above the arrow, or below it when there's more room there; always inside the window. It grows
 * away from the arrow (anchored by its bottom when above), so showing the sensitivity slider
 * never covers the button. */
function Popover({
  anchor,
  label,
  onClose,
  onSettings,
  children
}: {
  anchor: RefObject<HTMLButtonElement | null>
  label: string
  onClose(): void
  onSettings(): void
  children: ReactNode
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect()
    if (!a) return
    const left = Math.min(Math.max(GAP, a.left + a.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - GAP)
    const above = a.top >= window.innerHeight - a.bottom
    setStyle(
      above
        ? {
            left,
            bottom: window.innerHeight - a.top + GAP,
            maxHeight: a.top - 2 * GAP
          }
        : {
            left,
            top: a.bottom + GAP,
            maxHeight: window.innerHeight - a.bottom - 2 * GAP
          }
    )
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) onClose()
    }
    // Capture phase: Escape closes the popover, not the fullscreen call behind it.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  useEffect(watchDevices, [])

  return (
    <Detached>
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        style={{ ...style, width: WIDTH }}
        className={`fixed z-[55] space-y-3 overflow-y-auto p-3 text-sm ${menuClass}`}
      >
        {children}
        <button
          type="button"
          onClick={onSettings}
          className="flex w-full items-center gap-2 rounded-item px-1 py-1 text-xs font-medium text-fg-muted hover:text-fg"
        >
          <Settings size={14} />
          Configurações de voz e vídeo
        </button>
      </div>
    </Detached>
  )
}

/** A device list for one kind, switching the call to the picked one. */
function DeviceSelect({ kind, label }: { kind: DeviceKind; label: string }): ReactNode {
  const list = useDevices((s) => s.devices?.[kind])
  useVoice((s) => s.version) // the pick is saved by switchDevice, which bumps it
  const key = kind === 'audioinput' ? 'audioInput' : kind === 'audiooutput' ? 'audioOutput' : 'videoInput'
  const value = loadMediaPrefs()[key]
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select
        value={value}
        onChange={(e) => void useVoice.getState().switchDevice(kind, e.target.value)}
        className="w-full rounded-control border border-line bg-panel px-2.5 py-1.5 text-sm"
      >
        <option value="">Padrão do Windows</option>
        {/* The chosen device while it's unplugged: still the preference, shown as missing. */}
        {value && list && !list.some((d) => d.deviceId === value) && <option value={value}>Desconectado</option>}
        {list?.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Dispositivo ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}

function VolumeSlider({ which, label }: { which: 'inputVolume' | 'outputVolume'; label: string }): ReactNode {
  useVoice((s) => s.version)
  const value = loadMediaPrefs()[which]
  return (
    <label className="block">
      <span className={`${labelClass} flex justify-between`}>
        {label}
        <span className="tabular-nums">{value}%</span>
      </span>
      <input
        type="range"
        min={VOLUME_RANGE.min}
        max={VOLUME_RANGE.max}
        step={5}
        value={value}
        onChange={(e) => useVoice.getState().setVolume(which, Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  )
}

function MicOptions(): ReactNode {
  const [prefs, setPrefs] = useState<MediaPrefs>(loadMediaPrefs)
  const update = (patch: Partial<MediaPrefs>): void => {
    const next = { ...loadMediaPrefs(), ...patch }
    setPrefs(next)
    saveMediaPrefs(next)
    const voice = useVoice.getState()
    void ('inputMode' in patch ? voice.applyInputMode() : voice.applyMicProcessing())
  }
  const ptt = prefs.inputMode === 'ptt'

  return (
    <>
      <DeviceSelect kind="audioinput" label="Microfone" />
      <VolumeSlider which="inputVolume" label="Volume do microfone" />
      <div>
        <span className={labelClass}>Modo de entrada</span>
        <Segmented<'voice' | 'ptt'>
          options={[
            { value: 'voice', label: 'Detecção de voz', icon: AudioLines },
            { value: 'ptt', label: 'Pressionar para falar', icon: Keyboard }
          ]}
          value={prefs.inputMode}
          onChange={(inputMode) => update({ inputMode })}
        />
        {ptt && !prefs.pttKey && (
          <p className="mt-1.5 text-xs text-fg-subtle">Escolha a tecla em Configurações de voz e vídeo.</p>
        )}
      </div>
      {!ptt && (
        <div>
          <span className={labelClass}>Sensibilidade</span>
          <Segmented<'auto' | 'manual'>
            options={[
              { value: 'auto', label: 'Automática' },
              { value: 'manual', label: 'Manual' }
            ]}
            value={prefs.sensitivity}
            onChange={(sensitivity) => update({ sensitivity })}
          />
          {prefs.sensitivity === 'manual' && (
            <input
              type="range"
              aria-label="Sensibilidade do microfone"
              min={GATE_RANGE.min}
              max={GATE_RANGE.max}
              step={1}
              value={prefs.gateDb}
              onChange={(e) => update({ gateDb: Number(e.target.value) })}
              className="mt-2 w-full accent-accent"
            />
          )}
        </div>
      )}
    </>
  )
}

function OutputOptions(): ReactNode {
  return (
    <>
      <DeviceSelect kind="audiooutput" label="Saída de áudio" />
      <VolumeSlider which="outputVolume" label="Volume da chamada" />
    </>
  )
}

function CameraOptions(): ReactNode {
  return (
    <>
      <DeviceSelect kind="videoinput" label="Câmera" />
      <CameraPreview />
    </>
  )
}

/** A small preview of the chosen camera: the call's own track while it's on, else the camera
 * opened just for the preview (and closed with the popover). */
function CameraPreview(): ReactNode {
  const ref = useRef<HTMLVideoElement>(null)
  const cameraOn = useVoice((s) => s.camera)
  useVoice((s) => s.version)
  const deviceId = loadMediaPrefs().videoInput
  const [error, setError] = useState(false)

  useEffect(() => {
    const el = ref.current
    const me = getRoom()?.localParticipant.identity
    const track = cameraOn && me ? cameraTrackOf(me) : undefined
    if (!el) return
    if (track) {
      track.attach(el)
      return () => void track.detach(el)
    }
    let stream: MediaStream | null = null
    let cancelled = false
    setError(false)
    navigator.mediaDevices
      ?.getUserMedia({
        video: { deviceId: deviceId || undefined, width: { ideal: 320 } }
      })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        el.srcObject = s
      })
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      el.srcObject = null
    }
  }, [cameraOn, deviceId])

  return (
    <div className="relative aspect-video overflow-hidden rounded-control bg-scrim">
      <video ref={ref} autoPlay playsInline muted className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
      {error && <p className="absolute inset-0 flex items-center justify-center text-xs text-on-scrim">Câmera indisponível</p>}
    </div>
  )
}
