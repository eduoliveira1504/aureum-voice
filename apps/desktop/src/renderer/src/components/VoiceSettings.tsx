import { Mic, Square } from 'lucide-react'
import { Track, type AudioProcessorOptions } from 'livekit-client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { GATE_RANGE, gateOf, inputGainOf, isHandsFree, loadMediaPrefs, saveMediaPrefs, type MediaPrefs } from '../lib/mediaPrefs'
import { t as translate } from '../lib/i18n'
import { MicProcessor } from '../lib/micProcessor'
import { isMac } from '../lib/platform'
import { useAppearance } from '../store/appearance'
import { useDevices, watchDevices } from '../store/devices'
import { micCapture, useVoice } from '../store/voice'
import { InputModeSettings } from './InputModeSettings'
import { inputClass, labelClass, Segmented, ToggleRow } from './ui'

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
        if (!cancelled) setTest((t) => ({ ...t, error: translate('settings.voice.micError') }))
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
  const { t } = useTranslation()
  const { applyDevicePrefs, applyMicProcessing } = useVoice.getState()
  const [prefs, setPrefs] = useState<MediaPrefs>(loadMediaPrefs)
  const devices = useDevices((s) => s.devices)
  const [testing, setTesting] = useState(false)
  const [hearing, setHearing] = useState(false)
  const test = useMicTest(testing, prefs)
  useLoopback(testing && hearing ? test.output : null, prefs.audioOutput)

  useEffect(watchDevices, [])

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
        <option value="">{t('settings.voice.systemDefault')}</option>
        {list?.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || t('settings.voice.device', { number: i + 1 })}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="max-w-[440px] space-y-4">
      <div>
        {select(t('settings.voice.microphone'), 'audioInput', devices?.audioinput)}
        {inUse && <p className="mt-1.5 text-xs text-fg-subtle">{t('settings.voice.inUse', { device: inUse })}</p>}
        {inUse && isHandsFree(inUse) && (
          <p role="note" className="mt-2 rounded-control border border-line bg-elevated px-3 py-2 text-xs text-fg-muted">
            {t('settings.voice.handsFree')}
          </p>
        )}
      </div>
      {select(t('settings.voice.output'), 'audioOutput', devices?.audiooutput)}
      {select(t('settings.voice.camera'), 'videoInput', devices?.videoinput)}
      <ScreenVolumeDefault />

      <section className="space-y-2">
        <span className={labelClass}>{t('settings.voice.micTest')}</span>
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
            {testing ? t('settings.voice.stop') : t('settings.voice.test')}
          </button>
          <Meter level={testing ? test.level : -100} open={test.open} gateDb={gateOf(prefs)} />
        </div>
        {testing && (
          <ToggleRow
            title={t('settings.voice.hearMe')}
            description={t('settings.voice.hearMeHint')}
            checked={hearing}
            onChange={setHearing}
          />
        )}
        {test.error && <p className="text-xs text-danger">{test.error}</p>}
      </section>

      <ToggleRow
        title={t('settings.voice.noise')}
        description={t('settings.voice.noiseHint')}
        checked={prefs.noiseSuppression}
        onChange={(noiseSuppression) => update({ noiseSuppression }, false)}
      />
      <ToggleRow
        title={t('settings.voice.echo')}
        description={t('settings.voice.echoHint')}
        checked={prefs.echoCancellation}
        onChange={(echoCancellation) => update({ echoCancellation })}
      />
      <ToggleRow
        title={t('settings.voice.gain')}
        description={t('settings.voice.gainHint')}
        checked={prefs.autoGainControl}
        onChange={(autoGainControl) => update({ autoGainControl })}
      />

      {prefs.inputMode === 'voice' && (
        <section className="space-y-2">
          <span className={labelClass}>{t('settings.voice.sensitivity')}</span>
          <Segmented<'auto' | 'manual'>
            options={[
              { value: 'auto', label: t('settings.voice.auto') },
              { value: 'manual', label: t('settings.voice.manual') }
            ]}
            value={prefs.sensitivity}
            onChange={(sensitivity) => update({ sensitivity }, false)}
          />
          {prefs.sensitivity === 'manual' ? (
            <>
              <input
                type="range"
                aria-label={t('settings.voice.sensitivityAria')}
                min={GATE_RANGE.min}
                max={GATE_RANGE.max}
                step={1}
                value={prefs.gateDb}
                onChange={(e) => update({ gateDb: Number(e.target.value) }, false)}
                className="w-full accent-accent"
              />
              <p className="text-xs text-fg-subtle">
                {t('settings.voice.manualHint')}
              </p>
            </>
          ) : (
            <p className="text-xs text-fg-subtle">{t('settings.voice.autoHint')}</p>
          )}
        </section>
      )}

      {/* No push-to-talk on the Mac (block 3.21). */}
      {!isMac() && <InputModeSettings />}
    </div>
  )
}

/** "Volume padrão das transmissões" (3.24 C): where watching someone's screen starts when I never
 * adjusted them. Saved in the account; people with a volume of their own keep it. */
function ScreenVolumeDefault(): ReactNode {
  const { t } = useTranslation()
  const value = useAppearance((s) => s.settings.screen_volume_default)
  const update = useAppearance((s) => s.update)
  return (
    <section>
      <label className="block">
        <span className={labelClass}>{t('settings.voice.screenVolume')}</span>
        <span className="flex items-center gap-3">
          <input
            type="range"
            aria-label={t('settings.voice.screenVolume')}
            min={0}
            max={100}
            step={5}
            value={value}
            onChange={(e) => update({ screen_volume_default: Number(e.target.value) })}
            className="flex-1 accent-accent"
          />
          <span className="w-10 text-right text-sm tabular-nums text-fg-muted">{value}%</span>
        </span>
      </label>
      <p className="mt-1.5 text-xs text-fg-subtle">
        {t('settings.voice.screenVolumeHint')}
      </p>
    </section>
  )
}

/** The mic level bar, with the manual sensitivity mark. Filled with the accent while the voice
 * passes the gate. */
function Meter({ level, open, gateDb }: { level: number; open: boolean; gateDb: number | null }): ReactNode {
  const { t } = useTranslation()
  const passing = gateDb === null ? level > METER_FLOOR : open
  return (
    <div
      role="meter"
      aria-label={t('settings.voice.meter')}
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
