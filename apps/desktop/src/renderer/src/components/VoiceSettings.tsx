import { Mic, Square } from 'lucide-react'
import { Track, type AudioProcessorOptions } from 'livekit-client'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { GATE_RANGE, gateOf, inputGainOf, isHandsFree, loadMediaPrefs, saveMediaPrefs, type MediaPrefs } from '../lib/mediaPrefs'
import { MicProcessor } from '../lib/micProcessor'
import { micCapture, useVoice } from '../store/voice'
import { InputModeSettings } from './InputModeSettings'
import { inputClass, labelClass, Segmented, ToggleRow } from './ui'

interface Devices {
  audioinput: MediaDeviceInfo[]
  audiooutput: MediaDeviceInfo[]
  videoinput: MediaDeviceInfo[]
}

async function listDevices(): Promise<Devices> {
  let all = await navigator.mediaDevices.enumerateDevices()
  // Device names are hidden until media access is granted once.
  if (all.some((d) => d.kind === 'audioinput' && !d.label)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      all = await navigator.mediaDevices.enumerateDevices()
    } catch {
      // No permission or no mic: list whatever we have.
    }
  }
  const of = (kind: MediaDeviceKind): MediaDeviceInfo[] => all.filter((d) => d.kind === kind && d.deviceId !== 'communications')
  return { audioinput: of('audioinput'), audiooutput: of('audiooutput'), videoinput: of('videoinput') }
}

/** The meter's scale, in dBFS. */
const METER_FLOOR = -70
const meterPercent = (db: number): number => Math.min(100, Math.max(0, ((db - METER_FLOOR) / -METER_FLOOR) * 100))

interface MicTest {
  level: number
  open: boolean
  /** The device the test captured from (its label), once running. */
  deviceLabel: string | null
  error: string | null
  output: MediaStreamTrack | null
}

/**
 * Runs the mic through the same processor as a call (lib/micProcessor.ts) while `running`, and
 * reports its level. Restarts when a setting that changes the capture or the processing changes;
 * the sensitivity changes live.
 */
function useMicTest(running: boolean, prefs: MediaPrefs): MicTest {
  const [test, setTest] = useState<MicTest>({ level: -100, open: false, deviceLabel: null, error: null, output: null })
  const processor = useRef<MicProcessor | null>(null)
  const gate = gateOf(prefs)

  useEffect(() => {
    if (!running) return
    let cancelled = false
    let stream: MediaStream | null = null
    let current: MicProcessor | null = null
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: micCapture(prefs) as MediaTrackConstraints })
        const [track] = stream.getAudioTracks()
        current = new MicProcessor(prefs.noiseSuppression, gateOf(loadMediaPrefs()), inputGainOf(loadMediaPrefs()))
        current.onLevel((level, open) => !cancelled && setTest((t) => ({ ...t, level, open })))
        await current.init({ kind: Track.Kind.Audio, track } as AudioProcessorOptions)
        if (cancelled) return
        processor.current = current
        setTest({ level: -100, open: false, deviceLabel: track.label, error: null, output: current.processedTrack ?? null })
      } catch {
        if (!cancelled) setTest((t) => ({ ...t, error: 'Não foi possível abrir o microfone.' }))
      }
    })()
    return () => {
      cancelled = true
      processor.current = null
      void current?.destroy()
      stream?.getTracks().forEach((t) => t.stop())
      setTest({ level: -100, open: false, deviceLabel: null, error: null, output: null })
    }
    // Restarts only for changes to the capture or the processing chain; the gate changes live.
  }, [running, prefs.audioInput, prefs.echoCancellation, prefs.autoGainControl, prefs.noiseSuppression])

  useEffect(() => processor.current?.setGate(gate), [gate])
  return test
}

/** Plays the processed mic on the chosen output while `track` is set: "Ouvir minha voz". */
function useLoopback(track: MediaStreamTrack | null, outputId: string): void {
  useEffect(() => {
    if (!track) return
    const audio = new Audio()
    audio.srcObject = new MediaStream([track])
    void audio
      .setSinkId(outputId || 'default')
      .catch(() => {})
      .then(() => audio.play())
      .catch(() => {})
    return () => {
      audio.pause()
      audio.srcObject = null
    }
  }, [track, outputId])
}

/** Settings > Voz e vídeo: devices, the mic test, processing, sensitivity and the input mode. */
export function VoiceSettings(): ReactNode {
  const { applyDevicePrefs, applyMicProcessing } = useVoice.getState()
  const [prefs, setPrefs] = useState<MediaPrefs>(loadMediaPrefs)
  const [devices, setDevices] = useState<Devices | null>(null)
  const [testing, setTesting] = useState(false)
  const [hearing, setHearing] = useState(false)
  const test = useMicTest(testing, prefs)
  useLoopback(testing && hearing ? test.output : null, prefs.audioOutput)

  useEffect(() => {
    void listDevices().then(setDevices)
    const onChange = (): void => void listDevices().then(setDevices)
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }, [])

  /** `reopen`: the change needs the mic device reopened in a call (device, echo, gain). */
  function update(patch: Partial<MediaPrefs>, reopen = true): void {
    // Re-read: the input mode section saves the same prefs.
    const next = { ...loadMediaPrefs(), ...patch }
    setPrefs(next)
    saveMediaPrefs(next)
    void (reopen ? applyDevicePrefs() : applyMicProcessing())
  }

  // The device in use: what the test opened, else the chosen one, else the system default.
  const chosen = devices?.audioinput.find((d) => d.deviceId === (prefs.audioInput || 'default'))
  const inUse = test.deviceLabel ?? chosen?.label ?? null

  const select = (label: string, key: 'audioInput' | 'audioOutput' | 'videoInput', list: MediaDeviceInfo[] | undefined): ReactNode => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select value={prefs[key]} onChange={(e) => update({ [key]: e.target.value })} className={inputClass}>
        <option value="">Padrão do sistema</option>
        {list?.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Dispositivo ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="max-w-[440px] space-y-4">
      <div>
        {select('Microfone', 'audioInput', devices?.audioinput)}
        {inUse && <p className="mt-1.5 text-xs text-fg-subtle">Em uso: {inUse}</p>}
        {inUse && isHandsFree(inUse) && (
          <p role="note" className="mt-2 rounded-control border border-line bg-elevated px-3 py-2 text-xs text-fg-muted">
            Fones Bluetooth perdem qualidade quando o microfone deles está ligado. Se puder, use outro microfone.
          </p>
        )}
      </div>
      {select('Saída de áudio', 'audioOutput', devices?.audiooutput)}
      {select('Câmera', 'videoInput', devices?.videoinput)}

      <section className="space-y-2">
        <span className={labelClass}>Teste de microfone</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setTesting((t) => !t)
              setHearing(false)
            }}
            className="flex shrink-0 items-center gap-2 rounded-control border border-line bg-main px-3 py-2 text-sm font-medium hover:border-fg-subtle"
          >
            {testing ? <Square size={14} /> : <Mic size={16} />}
            {testing ? 'Parar' : 'Testar'}
          </button>
          <Meter level={testing ? test.level : -100} open={test.open} gateDb={gateOf(prefs)} />
        </div>
        {testing && (
          <ToggleRow
            title="Ouvir minha voz"
            description="Toca o microfone já com os ajustes abaixo, do jeito que os outros ouvem. Use fones, senão o som volta pro microfone."
            checked={hearing}
            onChange={setHearing}
          />
        )}
        {test.error && <p className="text-xs text-danger">{test.error}</p>}
      </section>

      <ToggleRow
        title="Supressão de ruído"
        description="Reduz barulho de fundo, como teclado e ventilador. Processado no seu PC, antes do áudio sair."
        checked={prefs.noiseSuppression}
        onChange={(noiseSuppression) => update({ noiseSuppression }, false)}
      />
      <ToggleRow
        title="Cancelamento de eco"
        description="Evita que o som das caixas de som volte pelo microfone. Com fone de ouvido, pode desligar."
        checked={prefs.echoCancellation}
        onChange={(echoCancellation) => update({ echoCancellation })}
      />
      <ToggleRow
        title="Ganho automático"
        description="Ajusta o volume do microfone sozinho para a sua voz chegar sempre no mesmo nível."
        checked={prefs.autoGainControl}
        onChange={(autoGainControl) => update({ autoGainControl })}
      />

      {prefs.inputMode === 'voice' && (
        <section className="space-y-2">
          <span className={labelClass}>Sensibilidade</span>
          <Segmented<'auto' | 'manual'>
            options={[
              { value: 'auto', label: 'Automática' },
              { value: 'manual', label: 'Manual' }
            ]}
            value={prefs.sensitivity}
            onChange={(sensitivity) => update({ sensitivity }, false)}
          />
          {prefs.sensitivity === 'manual' ? (
            <>
              <input
                type="range"
                aria-label="Sensibilidade do microfone"
                min={GATE_RANGE.min}
                max={GATE_RANGE.max}
                step={1}
                value={prefs.gateDb}
                onChange={(e) => update({ gateDb: Number(e.target.value) }, false)}
                className="w-full accent-accent"
              />
              <p className="text-xs text-fg-subtle">
                Abaixo da marca, o microfone fica mudo. Use o teste acima: a barra fica dourada quando a sua voz passa.
              </p>
            </>
          ) : (
            <p className="text-xs text-fg-subtle">O microfone fica aberto e a supressão de ruído tira o que não é voz.</p>
          )}
        </section>
      )}

      <InputModeSettings />
    </div>
  )
}

/** The mic level bar, with the manual sensitivity mark. Filled with the accent while the voice
 * passes the gate. */
function Meter({ level, open, gateDb }: { level: number; open: boolean; gateDb: number | null }): ReactNode {
  const passing = gateDb === null ? level > METER_FLOOR : open
  return (
    <div
      role="meter"
      aria-label="Volume do microfone"
      aria-valuemin={METER_FLOOR}
      aria-valuemax={0}
      aria-valuenow={Math.round(Math.max(METER_FLOOR, level))}
      className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-elevated"
    >
      <div
        className={`h-full rounded-full ${passing ? 'bg-accent' : 'bg-fg-subtle'}`}
        style={{ width: `${meterPercent(level)}%` }}
      />
      {gateDb !== null && (
        <div className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: `${meterPercent(gateDb)}%` }} aria-hidden />
      )}
    </div>
  )
}
