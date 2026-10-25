import { Check, ChartBar, EyeOff } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { Modal } from '../../components/Modal'
import { Avatar } from '../../components/ui'
import type { ChatEmbedProps } from '../types'
import { isClosed, leaders, nextVotes, percent, usePolls, type Poll } from './store'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "Encerra em 3 h" from now until the deadline. */
export function timeLeft(closesAt: string, now = Date.now()): string {
  const ms = new Date(closesAt).getTime() - now
  if (ms < MINUTE) return 'Encerra em instantes'
  if (ms < HOUR) return `Encerra em ${Math.ceil(ms / MINUTE)} min`
  if (ms < DAY) return `Encerra em ${Math.round(ms / HOUR)} h`
  const days = Math.round(ms / DAY)
  return `Encerra em ${days} ${days === 1 ? 'dia' : 'dias'}`
}

const votersLabel = (n: number): string => (n === 1 ? '1 voto' : `${n} votos`)

/** Ticks so the deadline text and the closed state follow the clock. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/** A poll inside its message: options with bars, votes, deadline and closing. */
export function PollCard({ message, channel, me, canModerate, userOf, nameOf }: ChatEmbedProps): ReactNode {
  const pollId = message.embed!.id
  const poll = usePolls((s) => s.polls[pollId])
  const [error, setError] = useState<string | null>(null)
  const [voters, setVoters] = useState(false)
  const now = useNow(!!poll && !poll.closed)

  useEffect(() => usePolls.getState().want(channel.id, pollId), [channel.id, pollId])

  if (!poll) {
    return (
      <div className="w-[min(420px,100%)] rounded-control border border-line bg-elevated px-4 py-3 text-sm text-fg-subtle">
        Carregando enquete…
      </div>
    )
  }

  const closed = isClosed(poll, now)
  const top = closed ? leaders(poll) : new Set<string>()
  const canClose = !closed && (poll.created_by === me.id || canModerate)

  async function pick(optionId: string): Promise<void> {
    setError(null)
    try {
      await usePolls.getState().vote(poll!, nextVotes(poll!, optionId))
    } catch {
      setError('Não foi possível registrar o voto.')
    }
  }

  async function close(): Promise<void> {
    setError(null)
    try {
      await usePolls.getState().close(poll!)
    } catch {
      setError('Não foi possível encerrar a enquete.')
    }
  }

  return (
    <div className="w-[min(420px,100%)] rounded-control border border-line bg-elevated p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        <ChartBar size={14} />
        Enquete
        {poll.anonymous && (
          <span className="flex items-center gap-1 normal-case tracking-normal" title="Ninguém vê quem votou em quê">
            · <EyeOff size={13} /> anônima
          </span>
        )}
      </p>
      <p className="mt-1.5 break-words font-display text-[17px] font-semibold leading-snug text-fg">{poll.question}</p>
      <p className="mt-0.5 text-xs text-fg-subtle">
        {closed ? 'Resultado final' : poll.multiple ? 'Escolha uma ou mais opções' : 'Escolha uma opção'}
      </p>

      <ul className="mt-3 space-y-1.5">
        {poll.options.map((option) => {
          const mine = poll.my_votes.includes(option.id)
          const pct = percent(poll, option)
          const winner = top.has(option.id)
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={closed}
                aria-pressed={mine}
                onClick={() => void pick(option.id)}
                className={`relative flex w-full items-center gap-2.5 overflow-hidden rounded-item border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${
                  mine ? 'border-accent' : 'border-line enabled:hover:border-fg-subtle'
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 transition-[width] duration-300 ${winner || mine ? 'bg-accent/20' : 'bg-line/60'}`}
                  style={{ width: `${pct}%` }}
                />
                <span
                  className={`relative flex h-4 w-4 shrink-0 items-center justify-center border ${poll.multiple ? 'rounded-sm' : 'rounded-full'} ${
                    mine ? 'border-accent bg-accent text-on-accent' : 'border-fg-subtle'
                  }`}
                >
                  {mine && <Check size={11} strokeWidth={3} />}
                </span>
                <span className={`relative min-w-0 flex-1 break-words ${winner ? 'font-semibold' : ''}`}>
                  {option.emoji && <span className="mr-1.5">{option.emoji}</span>}
                  {option.text}
                </span>
                <span className="relative shrink-0 text-xs tabular-nums text-fg-muted">
                  {pct}% · {option.votes}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
        <span>{votersLabel(poll.total_voters)}</span>
        <span>{closed ? 'Encerrada' : poll.closes_at ? timeLeft(poll.closes_at, now) : 'Sem prazo'}</span>
        {!poll.anonymous && poll.total_voters > 0 && (
          <button type="button" onClick={() => setVoters(true)} className="font-semibold text-accent-text hover:underline">
            Ver votos
          </button>
        )}
        {canClose && (
          <button type="button" onClick={() => void close()} className="ml-auto font-semibold text-fg-muted hover:text-fg hover:underline">
            Encerrar enquete
          </button>
        )}
      </div>
      {voters && <VotersModal poll={poll} userOf={userOf} nameOf={nameOf} onClose={() => setVoters(false)} />}
    </div>
  )
}

/** Who picked each option (never shown for an anonymous poll; the API doesn't say). */
function VotersModal({
  poll,
  userOf,
  nameOf,
  onClose
}: {
  poll: Poll
  userOf: ChatEmbedProps['userOf']
  nameOf: ChatEmbedProps['nameOf']
  onClose(): void
}): ReactNode {
  return (
    <Modal title="Votos" subtitle={poll.question} onClose={onClose}>
      <div className="space-y-4">
        {poll.options.map((option) => (
          <section key={option.id}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              {option.emoji && <span className="mr-1">{option.emoji}</span>}
              {option.text} · {option.votes}
            </h3>
            {option.voter_ids?.length ? (
              <ul className="space-y-1.5">
                {option.voter_ids.map((id) => {
                  const user = userOf(id)
                  const name = nameOf(id)
                  return (
                    <li key={id} className="flex items-center gap-2 text-sm">
                      <Avatar name={name} url={user?.avatar_url} size={24} />
                      <span className="truncate">{name}</span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-fg-subtle">Ninguém ainda.</p>
            )}
          </section>
        ))}
      </div>
    </Modal>
  )
}
