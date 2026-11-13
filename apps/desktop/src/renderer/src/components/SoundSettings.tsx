import { Play } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { OTHERS_SOUNDS, OWN_SOUNDS, playSound, soundKey, type SoundName } from '../lib/sounds'
import { useAppearance } from '../store/appearance'
import { SoundboardPrefs } from './Soundboard'
import { labelClass } from './ui'

/** Settings > Sounds: overall volume and an on/off switch per sound, each with a preview. */
export function SoundSettings(): ReactNode {
  const { t } = useTranslation()
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
              aria-label={t('settings.sounds.listenTo', { sound: t(`settings.sounds.names.${name}`) })}
              title={t('settings.sounds.listen')}
              onClick={() => playSound(name, { force: true })}
              className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
            >
              <Play size={14} />
            </button>
            <label className="flex flex-1 cursor-pointer items-center justify-between gap-4 text-sm">
              {t(`settings.sounds.names.${name}`)}
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
          {t('settings.sounds.volume')}
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
      {group(t('settings.sounds.own'), t('settings.sounds.ownHint'), OWN_SOUNDS)}
      {group(
        t('settings.sounds.others'),
        t('settings.sounds.othersHint'),
        OTHERS_SOUNDS
      )}
      <section>
        <span className={labelClass}>{t('settings.sounds.soundboard')}</span>
        <p className="-mt-1 mb-2 text-xs text-fg-subtle">{t('settings.sounds.soundboardHint')}</p>
        <SoundboardPrefs />
      </section>
    </div>
  )
}
