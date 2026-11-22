import { CheckCircle2, Grid3x3, Route, Search, Timer, Trophy, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ApiError } from '../../lib/api'
import type { User } from '../../lib/api'
import { checkAnswer, formatDuration, loadPuzzle, type DailyGameKey, type DailyPuzzle, type DailyResult, type RankEntry, type SudokuPuzzle, type TrilhaPuzzle, type WordSearchPuzzle } from '../../lib/daily'
import { t } from '../../lib/i18n'
import { useChat } from '../../store/chat'
import { useDaily } from '../../store/daily'
import { useSocial } from '../../store/social'
import { FormError, Modal } from '../Modal'
import { Avatar } from '../ui'
import { SudokuBoard } from './SudokuBoard'
import { TrilhaBoard } from './TrilhaBoard'
import { WordSearchBoard } from './WordSearchBoard'

/** Each daily game: its icon and its board. The board calls `onFilled` with an answer to check. */
export const DAILY_GAMES: Record<DailyGameKey, { icon: LucideIcon; board(puzzle: unknown, disabled: boolean, onFilled: (answer: unknown) => void): ReactNode }> = {
  sudoku: {
    icon: Grid3x3,
    board: (puzzle, disabled, onFilled) => <SudokuBoard puzzle={puzzle as SudokuPuzzle} disabled={disabled} onFilled={onFilled} />
  },
  trilha: {
    icon: Route,
    board: (puzzle, disabled, onFilled) => <TrilhaBoard puzzle={puzzle as TrilhaPuzzle} disabled={disabled} onFilled={onFilled} />
  },
  cacapalavras: {
    icon: Search,
    board: (puzzle, disabled, onFilled) => <WordSearchBoard puzzle={puzzle as WordSearchPuzzle} disabled={disabled} onFilled={onFilled} />
  }
}

export const gameName = (game: DailyGameKey): string => t(`games.games.${game}.name`)

/** Plays today's puzzle of a game: the board with a clock, the API's check, then the result. */
export function DailyGameModal({ game, onClose }: { game: DailyGameKey; onClose(): void }): ReactNode {
  const [puzzle, setPuzzle] = useState<DailyPuzzle | null>(null)
  const [result, setResult] = useState<DailyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const started = useRef(0)
  const [now, setNow] = useState(() => Date.now())
  const ranking = useRanking(game, puzzle?.ranking)

  useEffect(() => {
    loadPuzzle(game).then(
      (p) => {
        started.current = Date.now()
        setPuzzle(p)
        setResult(p.result)
      },
      () => setError(t('games.loadFailed'))
    )
  }, [game])

  // The clock ticks while playing.
  useEffect(() => {
    if (!puzzle || result) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [puzzle, result])

  async function onFilled(answer: unknown): Promise<void> {
    if (!puzzle) return
    setChecking(true)
    setError(null)
    try {
      const checked = await checkAnswer(game, puzzle.day, answer, Date.now() - started.current)
      if (checked.correct && checked.result) {
        setResult(checked.result)
        useDaily.getState().solved(checked.result)
      } else setError(t('games.wrong'))
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t('games.closed') : t('games.checkFailed'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal title={gameName(game)} subtitle={t(`games.games.${game}.rules`)} wide onClose={onClose}>
      <FormError message={error} />
      {!puzzle && !error && <p className="py-10 text-center text-sm text-fg-muted">{t('common.loading')}</p>}
      {puzzle && result && <ResultView result={result} ranking={ranking} />}
      {puzzle && !result && (
        <div className="flex flex-col items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm tabular-nums text-fg-muted" aria-label={t('games.time')}>
            <Timer size={16} />
            {formatDuration(now - started.current)}
          </span>
          {DAILY_GAMES[game].board(puzzle.puzzle, checking, (answer) => void onFilled(answer))}
        </div>
      )}
    </Modal>
  )
}

/** Today's ranking of a game: the card's (refreshed after solving), else what came with the puzzle. */
function useRanking(game: DailyGameKey, fallback: RankEntry[] | undefined): RankEntry[] {
  const fromSummary = useDaily((s) => s.summary?.rankings?.[game])
  return fromSummary ?? fallback ?? []
}

/** Who is who in a ranking: me, or one of my friends. */
export function useRankPeople(): (userId: string) => { name: string; user?: User } {
  const meId = useChat((s) => s.meId)
  const friends = useSocial((s) => s.friends)
  return (userId) => (userId === meId ? { name: t('games.you') } : { name: friends[userId]?.user.display_name ?? '…', user: friends[userId]?.user })
}

/** "Ranking dos amigos": position, person, time and tries, the user highlighted. */
export function Ranking({ entries }: { entries: RankEntry[] }): ReactNode {
  const meId = useChat((s) => s.meId)
  const person = useRankPeople()
  const friends = entries.filter((e) => e.user_id !== meId)
  return (
    <section aria-label={t('games.ranking')} className="w-full max-w-sm text-left">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Trophy size={16} className="text-accent-text" />
        {t('games.ranking')}
      </h3>
      {friends.length === 0 ? (
        <p className="text-sm text-fg-subtle">{t('games.rankingEmpty')}</p>
      ) : (
        <ol className="space-y-1">
          {entries.map((entry, i) => {
            const who = person(entry.user_id)
            return (
              <li
                key={entry.user_id}
                className={`flex items-center gap-2.5 rounded-item px-2 py-1.5 text-sm ${entry.user_id === meId ? 'bg-accent/10 font-semibold' : ''}`}
              >
                <span className="w-6 shrink-0 text-right tabular-nums text-fg-subtle">{i + 1}º</span>
                <Avatar name={who.name} url={who.user?.avatar_url} gif={who.user?.avatar_gif} size={24} />
                <span className="min-w-0 flex-1 truncate">{who.name}</span>
                <span className="shrink-0 text-xs text-fg-subtle">{t('games.attempts', { count: entry.attempts })}</span>
                <span className="w-14 shrink-0 text-right tabular-nums">{formatDuration(entry.time_ms)}</span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function ResultView({ result, ranking }: { result: DailyResult; ranking: RankEntry[] }): ReactNode {
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <CheckCircle2 size={48} className="text-success" />
      <div>
        <p className="font-display text-2xl font-semibold">{t('games.solved')}</p>
        <p className="mt-1 text-sm text-fg-muted">{t('games.solvedHint')}</p>
      </div>
      <dl className="grid grid-cols-2 gap-6">
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">{t('games.yourTime')}</dt>
          <dd className="font-display text-xl font-semibold tabular-nums">{formatDuration(result.time_ms)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">{t('games.yourAttempts')}</dt>
          <dd className="font-display text-xl font-semibold tabular-nums">{result.attempts}</dd>
        </div>
      </dl>
      <Ranking entries={ranking} />
    </div>
  )
}
