import { CheckCircle2, Grid3x3, Timer, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ApiError } from '../../lib/api'
import { checkAnswer, formatDuration, loadPuzzle, type DailyGameKey, type DailyPuzzle, type DailyResult, type SudokuPuzzle } from '../../lib/daily'
import { t } from '../../lib/i18n'
import { useDaily } from '../../store/daily'
import { FormError, Modal } from '../Modal'
import { SudokuBoard } from './SudokuBoard'

/** Each daily game: its icon and its board. The board calls `onFilled` with an answer to check. */
export const DAILY_GAMES: Record<DailyGameKey, { icon: LucideIcon; board(puzzle: unknown, disabled: boolean, onFilled: (answer: unknown) => void): ReactNode }> = {
  sudoku: {
    icon: Grid3x3,
    board: (puzzle, disabled, onFilled) => <SudokuBoard puzzle={puzzle as SudokuPuzzle} disabled={disabled} onFilled={onFilled} />
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
      {puzzle && result && <ResultView result={result} />}
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

function ResultView({ result }: { result: DailyResult }): ReactNode {
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
    </div>
  )
}
