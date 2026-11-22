import { CheckCircle2, Grid3x3, Lightbulb, Route, Search, Server, Timer, Trophy, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ApiError } from '../../lib/api'
import { useAuth } from '../../auth/AuthProvider'
import type { User } from '../../lib/api'
import {
  askHint,
  checkAnswer,
  formatDuration,
  HINT_SECONDS,
  loadPuzzle,
  saveProgress,
  type DailyGameKey,
  type DailyPuzzle,
  type DailyResult,
  type Difficulty,
  type Hint,
  type RankEntry,
  type SudokuPuzzle,
  type TrilhaPuzzle,
  type WordSearchPuzzle
} from '../../lib/daily'
import { t } from '../../lib/i18n'
import { useChat } from '../../store/chat'
import { useDaily } from '../../store/daily'
import { useSocial } from '../../store/social'
import { FormError, Modal } from '../Modal'
import { Avatar } from '../ui'
import { ShareChallengeModal, type ShareTarget } from './ShareChallenge'
import { SudokuBoard, type SudokuProgress } from './SudokuBoard'
import { TrilhaBoard, type TrilhaProgress } from './TrilhaBoard'
import { WordSearchBoard, type WordSearchProgress } from './WordSearchBoard'

const noop = (): void => {}

/** What a board gets while playing: a hint to apply, where it was left, and where to report changes. */
interface Play {
  hint: Hint | null
  saved: unknown
  onProgress(progress: unknown): void
}

/** Each daily game: its icon, its board (which calls `onFilled` with an answer to check), and the
 * board as someone solved it ("Ver jogo"). */
export const DAILY_GAMES: Record<
  DailyGameKey,
  {
    icon: LucideIcon
    board(puzzle: unknown, disabled: boolean, onFilled: (answer: unknown) => void, play?: Play): ReactNode
    solved(puzzle: unknown, answer: unknown): ReactNode
    /** What a hint needs to know of the board, out of its progress. */
    hintState(progress: unknown): unknown
  }
> = {
  sudoku: {
    icon: Grid3x3,
    board: (puzzle, disabled, onFilled, play) => (
      <SudokuBoard
        puzzle={puzzle as SudokuPuzzle}
        disabled={disabled}
        onFilled={onFilled}
        hint={play?.hint}
        saved={play?.saved as SudokuProgress | null}
        onProgress={play?.onProgress}
      />
    ),
    hintState: (progress) => (progress as SudokuProgress | null)?.cells ?? null,
    solved: (puzzle, answer) => <SudokuBoard puzzle={puzzle as SudokuPuzzle} disabled onFilled={noop} solved={answer as number[]} />
  },
  trilha: {
    icon: Route,
    board: (puzzle, disabled, onFilled, play) => (
      <TrilhaBoard
        puzzle={puzzle as TrilhaPuzzle}
        disabled={disabled}
        onFilled={onFilled}
        hint={play?.hint}
        saved={play?.saved as TrilhaProgress | null}
        onProgress={play?.onProgress}
      />
    ),
    hintState: (progress) => (progress as TrilhaProgress | null)?.path ?? [],
    solved: (puzzle, answer) => <TrilhaBoard puzzle={puzzle as TrilhaPuzzle} disabled onFilled={noop} solved={answer as number[]} />
  },
  cacapalavras: {
    icon: Search,
    board: (puzzle, disabled, onFilled, play) => (
      <WordSearchBoard
        puzzle={puzzle as WordSearchPuzzle}
        disabled={disabled}
        onFilled={onFilled}
        hint={play?.hint}
        saved={play?.saved as WordSearchProgress | null}
        onProgress={play?.onProgress}
      />
    ),
    hintState: (progress) => (progress as WordSearchProgress | null)?.order ?? [],
    solved: (puzzle, answer) => (
      <WordSearchBoard puzzle={puzzle as WordSearchPuzzle} disabled onFilled={noop} solved={answer as [number, number][]} />
    )
  }
}

export const gameName = (game: DailyGameKey): string => t(`games.games.${game}.name`)

const DIFFICULTY_TONE: Record<Difficulty, string> = {
  facil: 'bg-success/15 text-success',
  medio: 'bg-accent/15 text-accent-text',
  dificil: 'bg-danger/15 text-danger'
}

/** "Fácil", "Médio" or "Difícil": the day's draw for a game. */
export function DifficultyTag({ difficulty }: { difficulty: Difficulty | undefined }): ReactNode {
  if (!difficulty) return null
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${DIFFICULTY_TONE[difficulty]}`}>{t(`games.difficulty.${difficulty}`)}</span>
}

/** Seconds left until `until`, ticking. */
function useCountdown(until: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [until])
  return Math.max(0, Math.ceil((until - now) / 1000))
}

/** Plays today's puzzle of a game: the board with a clock, the API's check, then the result. */
export function DailyGameModal({ game, onClose }: { game: DailyGameKey; onClose(): void }): ReactNode {
  const [puzzle, setPuzzle] = useState<DailyPuzzle | null>(null)
  const [result, setResult] = useState<DailyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const started = useRef(0)
  const [now, setNow] = useState(() => Date.now())
  const ranking = useRanking(game, puzzle?.ranking)
  // The board as it is (block 4.2.10): kept by the API while unfinished, and what a hint looks at.
  const progress = useRef<unknown>(null)
  const dirty = useRef(false)
  const [hint, setHint] = useState<Hint | null>(null)
  const [hintsUsed, setHintsUsed] = useState(0)
  const [nextHintAt, setNextHintAt] = useState(0)
  const wait = useCountdown(nextHintAt)

  async function requestHint(): Promise<void> {
    if (!puzzle || wait > 0) return
    setError(null)
    try {
      const got = await askHint(game, puzzle.day, DAILY_GAMES[game].hintState(progress.current))
      setHint({ ...got.hint, n: got.used })
      setHintsUsed(got.used)
      setNextHintAt(Date.now() + HINT_SECONDS * 1000)
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setNextHintAt(Date.now() + HINT_SECONDS * 1000)
      else setError(t('games.hintFailed'))
    }
  }

  useEffect(() => {
    loadPuzzle(game).then(
      (p) => {
        // Where I left it: the clock picks up from the time played (closed, it doesn't count).
        started.current = Date.now() - (p.progress?.elapsed_ms ?? 0)
        setNow(Date.now())
        progress.current = p.progress?.state ?? null
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

  // Keeps the unfinished game: a moment after a move, every so often for the clock, and on closing.
  const solvedRef = useRef(false)
  solvedRef.current = !!result
  useEffect(() => {
    if (!puzzle || puzzle.result) return
    const keep = (): void => {
      if (solvedRef.current) return
      dirty.current = false
      saveProgress(game, puzzle.day, progress.current, Date.now() - started.current).catch(() => {})
    }
    const afterMove = setInterval(() => dirty.current && keep(), 1500)
    const clock = setInterval(keep, 15_000)
    return () => {
      clearInterval(afterMove)
      clearInterval(clock)
      keep()
    }
  }, [puzzle])

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
      {puzzle && (
        <div className="-mt-2 mb-3 flex justify-center">
          <DifficultyTag difficulty={(puzzle.puzzle as { difficulty?: Difficulty }).difficulty} />
        </div>
      )}
      <FormError message={error} />
      {!puzzle && !error && <p className="py-10 text-center text-sm text-fg-muted">{t('common.loading')}</p>}
      {puzzle && result && <ResultView game={game} puzzle={puzzle.puzzle} solved={result.answer ?? puzzle.solution} result={result} ranking={ranking} />}
      {puzzle && !result && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-sm tabular-nums text-fg-muted" aria-label={t('games.time')}>
              <Timer size={16} />
              {formatDuration(now - started.current)}
            </span>
            <button
              type="button"
              disabled={wait > 0 || checking}
              onClick={() => void requestHint()}
              className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg disabled:opacity-50"
            >
              <Lightbulb size={16} />
              {wait > 0 ? t('games.hintIn', { seconds: wait }) : t('games.hint')}
            </button>
            {hintsUsed > 0 && <span className="text-xs text-fg-subtle">{t('games.hintsUsed', { count: hintsUsed })}</span>}
          </div>
          {DAILY_GAMES[game].board(puzzle.puzzle, checking, (answer) => void onFilled(answer), {
            hint,
            saved: puzzle.progress?.state ?? null,
            onProgress: (state) => {
              progress.current = state
              dirty.current = true
            }
          })}
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
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user : undefined
  return (userId) =>
    userId === meId ? { name: t('games.you'), user: me } : { name: friends[userId]?.user.display_name ?? '…', user: friends[userId]?.user }
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
                {!!entry.hints && (
                  <span className="flex shrink-0 items-center gap-0.5 text-xs text-fg-subtle" title={t('games.hintsUsed', { count: entry.hints })}>
                    <Lightbulb size={12} />
                    {entry.hints}
                  </span>
                )}
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

/** After solving: the board as solved (my answer, or the answer key for results from before it
 * was kept), my time and tries, the challenge buttons and the ranking. */
function ResultView({
  game,
  puzzle,
  solved,
  result,
  ranking
}: {
  game: DailyGameKey
  puzzle: unknown
  solved: unknown
  result: DailyResult
  ranking: RankEntry[]
}): ReactNode {
  const [sharing, setSharing] = useState<ShareTarget | null>(null)
  const shareButton = 'flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-sm font-semibold hover:bg-elevated'
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <CheckCircle2 size={48} className="text-success" />
      <div>
        <p className="font-display text-2xl font-semibold">{t('games.solved')}</p>
        <p className="mt-1 text-sm text-fg-muted">{t('games.solvedHint')}</p>
      </div>
      <dl className="flex justify-center gap-6">
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">{t('games.yourTime')}</dt>
          <dd className="font-display text-xl font-semibold tabular-nums">{formatDuration(result.time_ms)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">{t('games.yourAttempts')}</dt>
          <dd className="font-display text-xl font-semibold tabular-nums">{result.attempts}</dd>
        </div>
        {!!result.hints && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">{t('games.yourHints')}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{result.hints}</dd>
          </div>
        )}
      </dl>
      {solved != null && (
        <section aria-label={t('games.solvedBoard')} className="w-full">
          {DAILY_GAMES[game].solved(puzzle, solved)}
        </section>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => setSharing('friends')} className={shareButton}>
          <Users size={16} />
          {t('games.share.friends')}
        </button>
        <button type="button" onClick={() => setSharing('server')} className={shareButton}>
          <Server size={16} />
          {t('games.share.server')}
        </button>
      </div>
      <Ranking entries={ranking} />
      {sharing && <ShareChallengeModal game={game} gameLabel={gameName(game)} day={result.day} target={sharing} onClose={() => setSharing(null)} />}
    </div>
  )
}
