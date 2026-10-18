import { Play } from 'lucide-react'
import type { ReactNode } from 'react'

import { OTHERS_SOUNDS, OWN_SOUNDS, playSound, soundKey, type SoundName } from '../lib/sounds'
import { useAppearance } from '../store/appearance'
import { labelClass } from './ui'

const LABELS: Record<SoundName, string> = {
  'call-join': 'Entrar na chamada',
  'call-leave': 'Sair da chamada',
  'call-outgoing': 'Chamando (quando você liga)',
  'call-ended': 'Chamada recusada ou encerrada',
  mute: 'Mutar o microfone',
  unmute: 'Desmutar o microfone',
  deafen: 'Ensurdecer',
  undeafen: 'Sair do ensurdecer',
  message: 'Mensagem direta ou menção',
  'call-ringing': 'Chamada recebida',
  'user-join': 'Alguém entrou na chamada',
  'user-leave': 'Alguém saiu da chamada',
  'screen-share': 'Compartilhamento de tela iniciado'
}

/** Settings > Sounds: overall volume and an on/off switch per sound, each with a preview. */
export function SoundSettings(): ReactNode {
  const sounds = useAppearance((s) => s.settings.sounds)
  const update = useAppearance((s) => s.update)
  const setVolume = (volume: number): void => update({ sounds: { ...sounds, volume } })
  const toggle = (name: SoundName, on: boolean): void =>
    update({ sounds: { ...sounds, events: { ...sounds.events, [soundKey(name)]: on } } })

  const group = (title: string, hint: string, names: SoundName[]): ReactNode => (
    <section>
      <span className={labelClass}>{title}</span>
      <p className="-mt-1 mb-2 text-xs text-fg-subtle">{hint}</p>
      <ul className="divide-y divide-line rounded-control border border-line bg-main">
        {names.map((name) => (
          <li key={name} className="flex items-center gap-3 px-3 py-2">
            <button
              type="button"
              aria-label={`Ouvir: ${LABELS[name]}`}
              title="Ouvir"
              onClick={() => playSound(name, { force: true })}
              className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
            >
              <Play size={14} />
            </button>
            <label className="flex flex-1 cursor-pointer items-center justify-between gap-4 text-sm">
              {LABELS[name]}
              <input
                type="checkbox"
                checked={sounds.events[soundKey(name)] !== false}
                onChange={(e) => toggle(name, e.target.checked)}
                className="h-5 w-5 shrink-0 accent-accent"
              />
            </label>
          </li>
        ))}
      </ul>
    </section>
  )

  return (
    <div className="max-w-[480px] space-y-6">
      <section>
        <label htmlFor="sound-volume" className={labelClass}>
          Volume dos sons
        </label>
        <div className="flex items-center gap-3">
          <input
            id="sound-volume"
            type="range"
            min={0}
            max={100}
            step={5}
            value={sounds.volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            // Preview at the new volume once the slider is let go.
            onPointerUp={() => playSound('message', { force: true })}
            onKeyUp={() => playSound('message', { force: true })}
            className="flex-1 accent-accent"
          />
          <span className="w-10 text-right text-sm tabular-nums text-fg-muted">{sounds.volume}%</span>
        </div>
      </section>
      {group('Suas ações', 'Confirmam o que você fez. Continuam tocando no Não perturbe.', OWN_SOUNDS)}
      {group(
        'Outras pessoas',
        'Silenciados no Não perturbe; chamadas recebidas viram só um aviso de chamada perdida. Durante uma chamada, mensagens tocam mais baixo.',
        OTHERS_SOUNDS
      )}
    </div>
  )
}
