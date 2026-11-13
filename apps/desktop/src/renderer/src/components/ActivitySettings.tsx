import { Eye, EyeOff, Gamepad2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import type { GamePrefs, KnownGame, RunningApp } from '../../../shared/types'
import { setManualActivity } from '../lib/gameActivity'
import { isMac } from '../lib/platform'
import { cn, inputClass, labelClass, ToggleRow } from './ui'

const games = window.aureum.games

/** "Jogando X": automatic game detection, the user's own games, hidden games and a manual activity. */
export function ActivitySettings(): ReactNode {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<GamePrefs | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [manual, setManual] = useState('')

  useEffect(() => {
    void games.getPrefs().then((p) => {
      setPrefs(p)
      setManual(p.manual ?? '')
    })
    void games.current().then(setCurrent)
    return games.onChange(setCurrent)
  }, [])

  if (!prefs) return null

  const update = async (patch: Partial<GamePrefs>): Promise<void> => {
    const next = await games.setPrefs(patch)
    setPrefs(next)
    if ('manual' in patch) setManualActivity(next.manual)
  }
  const hide = (name: string): Promise<void> => update({ hidden: [...prefs.hidden, name] })
  const unhide = (name: string): Promise<void> => update({ hidden: prefs.hidden.filter((h) => h !== name) })
  const addGame = (game: KnownGame): Promise<void> =>
    update({ custom: [game, ...prefs.custom.filter((g) => g.name.toLowerCase() !== game.name.toLowerCase())] })

  // The Mac has no game detection (block 3.21): only the manual activity.
  const detection = !isMac()

  return (
    <div className="max-w-2xl space-y-6">
      {detection && (
        <section className="space-y-3">
          <ToggleRow
            title={t('settings.activity.show')}
            description={t('settings.activity.showHint')}
            checked={prefs.enabled}
            onChange={(enabled) => void update({ enabled })}
          />
          <div className="flex items-center gap-3 rounded-control border border-line bg-main p-3">
            <Gamepad2 size={20} strokeWidth={1.8} className="shrink-0 text-fg-muted" />
            <div className="min-w-0 flex-1 text-sm">
              {!prefs.enabled ? (
                <span className="text-fg-muted">{t('settings.activity.off')}</span>
              ) : current ? (
                <Trans i18nKey="settings.activity.detected" values={{ game: current }} components={{ b: <span className="font-semibold" /> }} />
              ) : (
                <span className="text-fg-muted">{t('settings.activity.none')}</span>
              )}
            </div>
            {prefs.enabled && current && (
              <button type="button" onClick={() => void hide(current)} className="flex items-center gap-1.5 rounded-item px-2 py-1 text-sm text-fg-muted hover:bg-elevated hover:text-fg">
                <EyeOff size={16} /> {t('settings.activity.hide')}
              </button>
            )}
          </div>
        </section>
      )}

      <form
        className="space-y-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void update({ manual: manual.trim() || null })
        }}
      >
        <span className={labelClass}>{t('settings.activity.manual')}</span>
        <div className="flex gap-2">
          <input
            maxLength={64}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder={t('settings.activity.manualPlaceholder')}
            aria-label={t('settings.activity.manual')}
            className={cn(inputClass, 'min-w-0')}
          />
          <button type="submit" disabled={(manual.trim() || null) === prefs.manual} className="shrink-0 rounded-control bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50">
            {t('common.save')}
          </button>
          {prefs.manual && (
            <button
              type="button"
              onClick={() => {
                setManual('')
                void update({ manual: null })
              }}
              className="shrink-0 rounded-control px-3 text-sm text-fg-muted hover:bg-elevated hover:text-fg"
            >
              {t('settings.activity.clear')}
            </button>
          )}
        </div>
        <p className="text-xs text-fg-subtle">
          {detection ? t('settings.activity.manualHint') : t('settings.activity.manualHintMac')}
        </p>
      </form>

      {detection && (
        <section className="space-y-2">
          <span className={labelClass}>{t('settings.activity.myGames')}</span>
          <p className="text-xs text-fg-subtle">{t('settings.activity.myGamesHint')}</p>
          {prefs.custom.map((g) => (
            <div key={g.name} className="flex items-center gap-3 rounded-item bg-main px-3 py-2">
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{g.name}</span>
                <span className="block truncate text-xs text-fg-subtle">{g.exe.join(', ')}</span>
              </span>
              <button
                type="button"
                title={t('settings.activity.removeGame')}
                aria-label={t('settings.activity.removeNamed', { name: g.name })}
                onClick={() => void update({ custom: prefs.custom.filter((c) => c !== g) })}
                className="rounded-item p-1.5 text-fg-muted hover:bg-elevated hover:text-danger"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <AddGame onAdd={addGame} />
        </section>
      )}

      {detection && prefs.hidden.length > 0 && (
        <section className="space-y-2">
          <span className={labelClass}>{t('settings.activity.hidden')}</span>
          {prefs.hidden.map((name) => (
            <div key={name} className="flex items-center gap-3 rounded-item bg-main px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
              <button type="button" onClick={() => void unhide(name)} className="flex items-center gap-1.5 rounded-item px-2 py-1 text-sm text-fg-muted hover:bg-elevated hover:text-fg">
                <Eye size={16} /> {t('settings.activity.showAgain')}
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

/** Adds a game by picking an open program, or by typing its name and executable. */
function AddGame({ onAdd }: { onAdd(game: KnownGame): Promise<void> }): ReactNode {
  const { t } = useTranslation()
  const [running, setRunning] = useState<RunningApp[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [exe, setExe] = useState('')

  const list = async (): Promise<void> => {
    setLoading(true)
    const apps = await games.running().catch(() => [])
    // One row per program, without the Aureum window itself.
    const seen = new Set<string>()
    setRunning(
      apps
        .filter((a) => !/^(aureum voice|electron)\.exe$/i.test(a.exe) && !seen.has(a.exe.toLowerCase()) && seen.add(a.exe.toLowerCase()))
        .sort((a, b) => a.exe.localeCompare(b.exe))
    )
    setLoading(false)
  }

  const exeValid = /^[^\\/:*?"<>|]{1,128}\.exe$/i.test(exe.trim())
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim() || !exeValid) return
    void onAdd({ name: name.trim(), exe: [exe.trim()] }).then(() => {
      setName('')
      setExe('')
    })
  }

  return (
    <div className="space-y-3 rounded-control border border-dashed border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('settings.activity.add')}</span>
        <button type="button" onClick={() => void list()} disabled={loading} className="flex items-center gap-1.5 rounded-item px-2 py-1 text-sm text-accent-text hover:bg-elevated disabled:opacity-60">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {running ? t('settings.activity.refreshApps') : t('settings.activity.pickApp')}
        </button>
      </div>
      {running && (
        <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-item bg-main p-1">
          {running.length === 0 && <p className="px-2 py-1.5 text-sm text-fg-muted">{t('settings.activity.noApps')}</p>}
          {running.map((a) => (
            <button
              key={a.exe}
              type="button"
              onClick={() => {
                setExe(a.exe)
                setName(a.title.slice(0, 64))
              }}
              className={`flex w-full items-center gap-2 rounded-item px-2 py-1.5 text-left hover:bg-elevated ${exe === a.exe ? 'bg-elevated' : ''}`}
            >
              <span className="w-44 shrink-0 truncate text-sm font-medium" title={a.exe}>{a.exe}</span>
              <span className="min-w-0 truncate text-xs text-fg-subtle">{a.title}</span>
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <input maxLength={64} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.activity.gameName')} aria-label={t('settings.activity.gameName')} className={cn(inputClass, 'min-w-0')} />
        <input maxLength={132} value={exe} onChange={(e) => setExe(e.target.value)} placeholder={t('settings.activity.exePlaceholder')} aria-label={t('settings.activity.exe')} className={cn(inputClass, 'shrink-0 grow-0 basis-44')} />
        <button type="submit" disabled={!name.trim() || !exeValid} title={t('settings.activity.addShort')} aria-label={t('settings.activity.add')} className="shrink-0 rounded-control bg-accent px-3 text-on-accent hover:bg-accent-hover disabled:opacity-50">
          <Plus size={18} />
        </button>
      </form>
    </div>
  )
}
