import { Trophy } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { DAILY_GAMES, DailyGameModal, gameName } from '../../components/games/DailyGameModal'
import { Avatar } from '../../components/ui'
import { formatDuration, loadChannelRanking, type ChallengeEmbed, type RankEntry } from '../../lib/daily'
import { dateFormat } from '../../lib/format'
import { t } from '../../lib/i18n'
import { useDaily } from '../../store/daily'
import type { ChatEmbedProps } from '../types'

/** How many of the ranking show in the card. */
const SHOWN = 5

/**
 * A shared daily game challenge (block 4.2.10): who sent it and their result (never the answer),
 * the ranking of everyone here who played that day, and "Jogar" while it's still today's and the
 * viewer hasn't played; otherwise the viewer's own time.
 */
export function ChallengeCard({ message, channel, me, userOf, nameOf }: ChatEmbedProps): ReactNode {
  const embed = message.embed as unknown as ChallengeEmbed
  const known = !!DAILY_GAMES[embed.game]
  const summary = useDaily((s) => s.summary)
  const [ranking, setRanking] = useState<RankEntry[] | null>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!summary) void useDaily.getState().load()
  }, [])
  // Again when the viewer solves a game, so they show up in it.
  const solvedHere = summary?.results.find((r) => r.game === embed.game && r.day === embed.day)
  useEffect(() => {
    if (!known) return
    loadChannelRanking(embed.game, channel.id, embed.day).then(setRanking, () => setRanking([]))
  }, [channel.id, embed.game, embed.day, known, solvedHere?.time_ms])

  const author = message.author ? nameOf(message.author.id) : t('call.someone')
  const today = summary?.day === embed.day
  const mine = ranking?.find((r) => r.user_id === me.id)
  const Icon = known ? DAILY_GAMES[embed.game].icon : Trophy
  const date = dateFormat({ day: 'numeric', month: 'short' }).format(new Date(`${embed.day}T12:00:00`))

  return (
    <div className="mt-1 max-w-md rounded-panel border border-line bg-panel p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent/15 text-accent-text">
          <Icon size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t('games.challenge.title')}</p>
          <p className="truncate font-display font-semibold">{t('games.challenge.when', { game: known ? gameName(embed.game) : embed.game, date })}</p>
        </div>
      </div>
      <p className="mt-2 text-sm">
        {t('games.challenge.by', { name: author, time: formatDuration(embed.time_ms) })}
      </p>

      {!known ? (
        <p className="mt-3 text-sm text-fg-muted">{t('games.challenge.unknown')}</p>
      ) : (
        <>
          <div className="mt-3">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-fg-subtle">
              <Trophy size={12} />
              {t('games.challenge.ranking')}
            </p>
            {ranking && ranking.length === 0 && <p className="text-sm text-fg-subtle">{t('games.challenge.nobody')}</p>}
            <ol className="space-y-0.5">
              {(ranking ?? []).slice(0, SHOWN).map((entry, i) => {
                const user = userOf(entry.user_id)
                const name = entry.user_id === me.id ? t('games.you') : nameOf(entry.user_id)
                return (
                  <li key={entry.user_id} className={`flex items-center gap-2 rounded-item px-1.5 py-1 text-sm ${entry.user_id === me.id ? 'bg-accent/10 font-semibold' : ''}`}>
                    <span className="w-5 shrink-0 text-right tabular-nums text-fg-subtle">{i + 1}º</span>
                    <Avatar name={name} url={user?.avatar_url} gif={user?.avatar_gif} size={20} />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <span className="shrink-0 tabular-nums">{formatDuration(entry.time_ms)}</span>
                  </li>
                )
              })}
            </ol>
          </div>
          <div className="mt-3">
            {mine ? (
              <p className="text-sm font-semibold text-accent-text">{t('games.challenge.yours', { time: formatDuration(mine.time_ms) })}</p>
            ) : today ? (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                className="rounded-control bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-hover"
              >
                {t('games.challenge.play')}
              </button>
            ) : (
              summary && <p className="text-sm text-fg-subtle">{t('games.challenge.closed')}</p>
            )}
          </div>
        </>
      )}
      {playing && <DailyGameModal game={embed.game} onClose={() => setPlaying(false)} />}
    </div>
  )
}
