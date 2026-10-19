import { AudioLines, Keyboard } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { loadMediaPrefs, saveMediaPrefs, type MediaPrefs } from '../lib/mediaPrefs'
import { pttKeyLabel, pttKeyOfKeyboard, pttKeyOfMouse } from '../lib/pushToTalk'
import { soundKey } from '../lib/sounds'
import { useAppearance } from '../store/appearance'
import { useVoice } from '../store/voice'
import { labelClass, Segmented, ToggleRow } from './ui'

/**
 * Settings > Voz e vídeo: voice activity or push-to-talk, the key and its sounds. Saved on this PC.
 * Picking push-to-talk without a key starts recording one right away.
 */
export function InputModeSettings(): ReactNode {
  const [prefs, setPrefs] = useState<MediaPrefs>(loadMediaPrefs)
  const [recording, setRecording] = useState(false)
  const sounds = useAppearance((s) => s.settings.sounds)
  const soundsOn = sounds.events[soundKey('ptt-on')] !== false && sounds.events[soundKey('ptt-off')] !== false

  function update(patch: Partial<MediaPrefs>): void {
    // Re-read: other settings on this tab write the same prefs.
    const next = { ...loadMediaPrefs(), ...patch }
    setPrefs(next)
    saveMediaPrefs(next)
    void useVoice.getState().applyInputMode()
  }

  useEffect(() => {
    if (!recording) return
    const done = (key: string): void => {
      setRecording(false)
      update({ pttKey: key, inputMode: 'ptt' })
    }
    const onKey = (e: KeyboardEvent): void => {
      // Capture phase: before the settings modal sees Escape and closes.
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') return setRecording(false)
      const key = pttKeyOfKeyboard(e.code)
      if (key) done(key)
    }
    const onMouse = (e: MouseEvent): void => {
      const key = pttKeyOfMouse(e.button)
      if (!key) return
      e.preventDefault()
      done(key)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onMouse, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onMouse, true)
    }
  }, [recording])

  const setSounds = (on: boolean): void =>
    void useAppearance.getState().update({
      sounds: { ...sounds, events: { ...sounds.events, [soundKey('ptt-on')]: on, [soundKey('ptt-off')]: on } }
    })

  const ptt = prefs.inputMode === 'ptt'
  return (
    <section className="space-y-3">
      <span className={labelClass}>Modo de entrada</span>
      <Segmented<'voice' | 'ptt'>
        options={[
          { value: 'voice', label: 'Detecção de voz', icon: AudioLines },
          { value: 'ptt', label: 'Pressionar para falar', icon: Keyboard }
        ]}
        value={prefs.inputMode}
        onChange={(inputMode) => {
          if (inputMode === 'ptt' && !prefs.pttKey) setRecording(true)
          update({ inputMode })
        }}
      />
      {ptt && (
        <>
          <div className="rounded-control border border-line bg-main px-3 py-2.5">
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium">Tecla para falar</span>
              <button
                type="button"
                onClick={() => setRecording((r) => !r)}
                className={`min-w-40 rounded-control border px-3 py-1.5 text-sm font-medium ${
                  recording ? 'border-accent text-accent-text' : 'border-line bg-elevated hover:border-fg-subtle'
                }`}
              >
                {recording ? 'Pressione uma tecla…' : prefs.pttKey ? pttKeyLabel(prefs.pttKey) : 'Escolher tecla'}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-fg-subtle">
              {recording
                ? 'Uma tecla ou um botão lateral do mouse. Esc cancela.'
                : 'Funciona com o Aureum em segundo plano e em jogos. O app lê só essa tecla, e só enquanto você está numa call nesse modo.'}
            </p>
            {!prefs.pttKey && !recording && (
              <p className="mt-1.5 text-xs text-danger">Sem tecla escolhida, o microfone funciona por detecção de voz.</p>
            )}
          </div>
          <ToggleRow
            title="Som ao apertar e soltar"
            description="Um clique curto confirma quando o microfone abre e fecha."
            checked={soundsOn}
            onChange={setSounds}
          />
        </>
      )}
    </section>
  )
}
