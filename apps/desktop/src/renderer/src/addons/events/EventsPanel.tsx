import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Repeat, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ConfirmModal } from '../../components/modals'
import { Avatar, MenuItem, menuClass, useDismiss } from '../../components/ui'
import { ApiError, type ServerDetail, type User } from '../../lib/api'
import { serverPeople } from '../../lib/members'
import { useVoice } from '../../store/voice'
import type { AddonViewProps } from '../types'
import { countLabel, Cover, DateBlock, isHappening, Place, whenLabel } from './bits'
import { EventModal } from './EventModal'
import { ANSWER_LABEL, myAnswer, splitEvents, useEvents, type Answer, type EventItem } from './store'

const ANSWERS: Answer[] = ['going', 'maybe', 'no']
const FLASH_MS = 2000

const failure = (err: unknown): string =>
  err instanceof ApiError && err.status === 403
    ? 'Você não tem permissão para isso.'
    : err instanceof ApiError && err.status === 409
      ? 'Esse evento já foi cancelado ou terminou.'
      : 'Não foi possível salvar a mudança.'

/** The channel's events: coming up (with answers) and past ones. `openItem` is an event to show,
 * or "new" / "new:YYYY-MM-DD" to start creating one. */
export function EventsPanel({ server, channel, me, openItem, onItemOpened }: AddonViewProps): ReactNode {
  const list = useEvents((s) => s.lists[channel.id])
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [editing, setEditing] = useState<EventItem | 'new' | null>(null)
  const [newDay, setNewDay] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const people = useMemo(() => serverPeople(server), [server])

  useEffect(() => {
    setLoadError(false)
    useEvents.getState().load(channel.id).catch(() => setLoadError(true))
  }, [channel.id])

  useEffect(() => {
    if (!openItem || !list) return
    if (openItem.startsWith('new')) {
      if (list.can_manage) {
        setNewDay(openItem.split(':')[1] ?? null)
        setEditing('new')
      }
    } else if (list.events.some((e) => e.id === openItem)) {
      if (list.events.find((e) => e.id === openItem)?.over) setShowPast(true)
      setFlash(openItem)
    }
    onItemOpened?.()
  }, [openItem, list, onItemOpened])

  useEffect(() => {
    if (!flash) return
    document.querySelector(`[data-event-id="${flash}"]`)?.scrollIntoView({ block: 'center' })
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash, showPast])

  if (loadError) return <p className="p-6 text-center text-sm text-danger">Não foi possível carregar os eventos.</p>
  if (!list) return <p className="p-6 text-center text-sm text-fg-subtle">Carregando…</p>
  const { upcoming, past } = splitEvents(list.events)

  const card = (event: EventItem): ReactNode => (
    <EventCard
      key={event.id}
      server={server}
      channelId={channel.id}
      event={event}
      meId={me.id}
      canManage={list.can_manage}
      people={people}
      flash={flash === event.id}
      onEdit={() => setEditing(event)}
      onError={setError}
    />
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-main">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-sm">
        <span className="text-fg-muted">
          {upcoming.length === 1 ? '1 evento marcado' : `${upcoming.length} eventos marcados`}
        </span>
        {error && (
          <span role="alert" className="text-danger">
            {error}
          </span>
        )}
        {list.can_manage && (
          <button
            type="button"
            onClick={() => {
              setNewDay(null)
              setEditing('new')
            }}
            className="ml-auto flex items-center gap-1.5 rounded-control bg-accent px-3 py-1.5 font-semibold text-on-accent hover:bg-accent-hover"
          >
            <Plus size={16} /> Criar evento
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!upcoming.length && (
          <p className="py-10 text-center text-sm text-fg-subtle">
            {list.can_manage ? 'Nenhum evento marcado. Crie um para juntar o grupo.' : 'Nenhum evento marcado.'}
          </p>
        )}
        <ul className="mx-auto max-w-[720px] space-y-3">{upcoming.map(card)}</ul>
        {!!past.length && (
          <section className="mx-auto mt-6 max-w-[720px]">
            <button
              type="button"
              onClick={() => setShowPast((s) => !s)}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg"
            >
              {showPast ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Anteriores ({past.length})
            </button>
            {showPast && <ul className="mt-3 space-y-3 opacity-80">{past.map(card)}</ul>}
          </section>
        )}
      </div>

      {editing && (
        <EventModal
          server={server}
          channelId={channel.id}
          event={editing === 'new' ? undefined : editing}
          day={newDay}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function EventCard({
  server,
  channelId,
  event,
  meId,
  canManage,
  people,
  flash,
  onEdit,
  onError
}: {
  server: ServerDetail
  channelId: string
  event: EventItem
  meId: string
  canManage: boolean
  people: Map<string, User>
  flash: boolean
  onEdit(): void
  onError(message: string | null): void
}): ReactNode {
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)
  const [whoOpen, setWhoOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setMenu(false), [])
  useDismiss(ref, menu, close)
  const store = useEvents.getState()
  const mine = myAnswer(event, meId)
  const cancelled = !!event.cancelled_at
  const happening = isHappening(event)
  const inRoom = useVoice((s) => s.phase !== 'idle' && s.channelId === event.location_channel_id)
  const answerable = !cancelled && !event.over

  function run(action: () => Promise<unknown>): void {
    setMenu(false)
    onError(null)
    action().catch((err: unknown) => onError(failure(err)))
  }

  return (
    <li
      data-event-id={event.id}
      className={`overflow-hidden rounded-panel border bg-panel transition-colors duration-700 ${flash ? 'border-accent bg-accent/10' : 'border-line'}`}
    >
      <Cover channelId={channelId} event={event} className="h-32 w-full" />
      <div className="flex gap-3 p-4">
        <DateBlock iso={event.occurrence.starts_at} muted={cancelled || event.over} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className={`min-w-0 flex-1 break-words font-display text-[17px] font-semibold ${cancelled ? 'text-fg-subtle line-through' : ''}`}>
              {event.title}
            </h3>
            {cancelled && <span className="shrink-0 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">Cancelado</span>}
            {happening && <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">Agora</span>}
            {canManage && (
              <div ref={ref} className="relative shrink-0">
                <button
                  type="button"
                  aria-label="Mais opções"
                  onClick={() => setMenu((m) => !m)}
                  className="rounded-item p-1 text-fg-subtle hover:bg-elevated hover:text-fg"
                >
                  <MoreHorizontal size={18} />
                </button>
                {menu && (
                  <div className={`absolute right-0 top-full mt-1 w-48 ${menuClass}`}>
                    <MenuItem
                      label="Editar"
                      onClick={() => {
                        setMenu(false)
                        onEdit()
                      }}
                    />
                    {event.cover && <MenuItem label="Remover capa" onClick={() => run(() => store.removeCover(channelId, event.id))} />}
                    {!cancelled && !event.over && (
                      <MenuItem
                        label="Cancelar evento"
                        onClick={() => {
                          setMenu(false)
                          setConfirm('cancel')
                        }}
                      />
                    )}
                    <MenuItem
                      label="Excluir"
                      danger
                      onClick={() => {
                        setMenu(false)
                        setConfirm('delete')
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-fg-muted">
            <span>{whenLabel(event.occurrence.starts_at, event.occurrence.ends_at)}</span>
            {event.repeat === 'weekly' && (
              <span className="flex items-center gap-1">
                <Repeat size={14} /> Toda semana
              </span>
            )}
            <Place event={event} server={server} />
          </p>
          {event.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg">{event.description}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {answerable &&
              ANSWERS.map((answer) => (
                <button
                  key={answer}
                  type="button"
                  aria-pressed={mine === answer}
                  onClick={() => run(() => store.answer(channelId, event.id, mine === answer ? null : answer))}
                  className={`rounded-control border px-3 py-1 text-sm font-medium transition-colors ${
                    mine === answer ? 'border-accent bg-accent text-on-accent' : 'border-line text-fg-muted hover:border-fg-subtle hover:text-fg'
                  }`}
                >
                  {ANSWER_LABEL[answer]}
                </button>
              ))}
            <button type="button" onClick={() => setWhoOpen((o) => !o)} className="text-sm text-fg-subtle hover:text-fg hover:underline">
              {countLabel(event)}
            </button>
            {happening && event.location_channel_id && !inRoom && (
              <button
                type="button"
                onClick={() => void useVoice.getState().join(server.id, event.location_channel_id!)}
                className="ml-auto flex items-center gap-1.5 rounded-control bg-accent px-3 py-1 text-sm font-semibold text-on-accent hover:bg-accent-hover"
              >
                <Volume2 size={16} /> Entrar na sala
              </button>
            )}
          </div>
          {whoOpen && <Attendees event={event} people={people} />}
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm === 'cancel' ? 'Cancelar evento' : 'Excluir evento'}
          message={
            confirm === 'cancel'
              ? 'Quem marcou Vou ou Talvez recebe um aviso. O evento continua na lista, como cancelado.'
              : 'O evento some da lista. Se ainda não aconteceu, quem marcou Vou ou Talvez recebe um aviso.'
          }
          confirmLabel={confirm === 'cancel' ? 'Cancelar evento' : 'Excluir'}
          onConfirm={() => (confirm === 'cancel' ? store.cancel(channelId, event.id) : store.remove(channelId, event.id))}
          onClose={() => setConfirm(null)}
        />
      )}
    </li>
  )
}

function Attendees({ event, people }: { event: EventItem; people: Map<string, User> }): ReactNode {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      {ANSWERS.map((answer) => (
        <section key={answer}>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            {ANSWER_LABEL[answer]} · {event.responses[answer].length}
          </h4>
          <ul className="space-y-1">
            {event.responses[answer].map((id) => {
              const user = people.get(id)
              const name = user?.display_name ?? 'Alguém'
              return (
                <li key={id} className="flex items-center gap-2 text-sm">
                  <Avatar name={name} url={user?.avatar_url} size={20} />
                  <span className="truncate">{name}</span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
