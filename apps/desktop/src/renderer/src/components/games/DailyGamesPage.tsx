import { CheckCircle2, Flame, Gamepad2, Snowflake } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { User } from '../../lib/api'
import { formatDuration, type DailyGameKey } from '../../lib/daily'
import { t } from '../../lib/i18n'
import { useChat } from '../../store/chat'
import { useDaily } from '../../store/daily'
import { useSocial } from '../../store/social'
import { Avatar } from '../ui'
import { DAILY_GAMES, DailyGameModal, gameName, useRankPeople } from './DailyGameModal'

/** Top of a game's ranking shown on its card. */
const PODIUM = 3

/**
 * "Jogos do dia" (block 4.2.10), opened from Home's sidebar: today's games to pick from, each with
 * my result or "Jogar", the friends' best times, the streak and who already played.
 */
export function DailyGamesPage(): ReactNode {
  const summary = useDaily((s) => s.summary)
  const failed = useDaily((s) => s.failed)
  const friends = useSocial((s) => s.friends)
  const [playing, setPlaying] = useState<DailyGameKey | null>(null)
  useEffect(() => {
    void useDaily.getState().load()
  }, [])

  const played = (summary?.friends_today ?? [])
    .map((f) => friends[f.user_id]?.user)
    .filter((u): u is User => !!u)

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-8 py-7">
        <header className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold">
              <Gamepad2 size={26} className="text-accent-text" />
              {t('games.title')}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">{t('games.hint')}</p>
          </div>
          {summary && summary.streak > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1.5 text-sm font-semibold text-accent-text">
              <Flame size={16} />
              {t('games.streak', { count: summary.streak })}
            </span>
          )}
        </header>

        {!summary ? (
          <p className="py-10 text-center text-sm text-fg-muted">{failed ? t('games.loadFailed') : t('common.loading')}</p>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {summary.games.filter((g) => DAILY_GAMES[g]).map((game) => (
                <li key={game}>
                  <GameCard game={game} onPlay={() => setPlaying(game)} />
                </li>
              ))}
            </ul>
            <p className="flex items-center gap-2 text-sm text-fg-subtle">
              {played.length > 0 && (
                <span className="flex shrink-0">
                  {played.slice(0, 5).map((u, i) => (
                    <span key={u.id} className={`rounded-full border-2 border-main ${i > 0 ? '-ml-2' : ''}`}>
                      <Avatar name={u.display_name} url={u.avatar_url} gif={u.avatar_gif} size={24} />
                    </span>
                  ))}
                </span>
              )}
              {played.length === 0
                ? t('games.noFriends')
                : played.length === 1
                  ? t('games.friendsOne', { name: played[0].display_name })
                  : t('games.friendsMany', { name: played[0].display_name, count: played.length - 1 })}
            </p>
          </>
        )}
      </div>
      {playing && <DailyGameModal game={playing} onClose={() => setPlaying(null)} />}
    </div>
  )
}

function GameCard({ game, onPlay }: { game: DailyGameKey; onPlay(): void }): ReactNode {
  const summary = useDaily((s) => s.summary)
  const meId = useChat((s) => s.meId)
  const person = useRankPeople()
  const result = summary?.results.find((r) => r.game === game)
  const ranking = summary?.rankings?.[game] ?? []
  const position = ranking.findIndex((r) => r.user_id === meId) + 1
  const best = !result ? ranking.find((r) => r.user_id !== meId) : undefined
  const streak = summary?.streaks?.[game]
  const Icon = DAILY_GAMES[game].icon

  return (
    <article aria-label={gameName(game)} className="flex h-full flex-col gap-3 rounded-panel border border-line bg-panel/40 p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-accent/15 text-accent-text">
          <Icon size={24} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-semibold">{gameName(game)}</h2>
          {result ? (
            <p className="flex items-center gap-1 text-sm text-fg-muted">
              <CheckCircle2 size={14} className="shrink-0 text-success" />
              {t('games.done', { time: formatDuration(result.time_ms) })}
              {ranking.length > 1 && position > 0 && ` · ${t('games.position', { position, total: ranking.length })}`}
            </p>
          ) : (
            <p className="text-sm text-fg-subtle">{t('games.notYet')}</p>
          )}
        </div>
      </div>
      {streak && (streak.days > 0 || streak.freezes > 0) && (
        <p className="flex flex-wrap items-center gap-3 text-sm" title={t('games.freezesHint')}>
          {streak.days > 0 && (
            <span className="flex items-center gap-1 font-semibold text-accent-text">
              <Flame size={14} />
              {t('games.streak', { count: streak.days })}
            </span>
          )}
          {streak.freezes > 0 && (
            <span className="flex items-center gap-1 text-fg-muted">
              <Snowflake size={14} />
              {t('games.freezes', { count: streak.freezes })}
            </span>
          )}
        </p>
      )}
      <p className="text-sm text-fg-muted">{t(`games.games.${game}.rules`)}</p>
      {best && <p className="text-sm font-medium">{t('games.beat', { name: person(best.user_id).name, time: formatDuration(best.time_ms) })}</p>}
      {ranking.length > 0 && (
        <ol className="space-y-0.5">
          {ranking.slice(0, PODIUM).map((entry, i) => {
            const who = person(entry.user_id)
            return (
              <li key={entry.user_id} className={`flex items-center gap-2 rounded-item px-1.5 py-1 text-sm ${entry.user_id === meId ? 'bg-accent/10 font-semibold' : ''}`}>
                <span className="w-5 shrink-0 text-right tabular-nums text-fg-subtle">{i + 1}º</span>
                <Avatar name={who.name} url={who.user?.avatar_url} gif={who.user?.avatar_gif} size={20} />
                <span className="min-w-0 flex-1 truncate">{who.name}</span>
                <span className="shrink-0 tabular-nums">{formatDuration(entry.time_ms)}</span>
              </li>
            )
          })}
        </ol>
      )}
      <button
        type="button"
        onClick={onPlay}
        className={`mt-auto rounded-control px-4 py-2 text-sm font-semibold ${
          result ? 'border border-line text-fg hover:bg-elevated' : 'bg-accent text-on-accent hover:bg-accent-hover'
        }`}
      >
        {result ? t('games.seeResult') : t('games.playNamed', { game: gameName(game) })}
      </button>
    </article>
  )
}
