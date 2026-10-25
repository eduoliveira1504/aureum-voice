import { useState, type FormEvent, type ReactNode } from 'react'

import { FormError, Modal } from '../../components/Modal'
import { cn, inputClass, labelClass, PrimaryButton, Segmented } from '../../components/ui'
import { ApiError, type ServerDetail } from '../../lib/api'
import { localZone, useEvents, type EventFields, type EventItem, type Repeat } from './store'

type PlaceKind = 'none' | 'room' | 'text'

const pad = (n: number): string => String(n).padStart(2, '0')

/** A Date as a datetime-local input value, in the user's zone. */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Where a new event starts: on `day` (YYYY-MM-DD) at 20:00, or at the next full hour. */
export function defaultStart(day?: string | null, now = new Date()): Date {
  if (day) {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y, m - 1, d, 20, 0)
  }
  const start = new Date(now)
  start.setHours(start.getHours() + 1, 0, 0, 0)
  return start
}

const HOUR = 60 * 60 * 1000

function failure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'Você não tem permissão para isso.'
    if (err.status === 413) return 'A capa pode ter até 5 MB.'
    if (err.status === 415) return 'Use uma imagem PNG, JPG, GIF ou WebP.'
    if (err.detail === "The event can't start in the past") return 'O evento não pode começar no passado.'
    if (String(err.detail ?? '').startsWith('This event is too long')) return 'Evento longo demais (até 14 dias; se repetir toda semana, até 7).'
  }
  return 'Não foi possível salvar o evento.'
}

/** Create an event (optionally on a given day) or edit one. */
export function EventModal({
  server,
  channelId,
  event,
  day,
  onClose
}: {
  server: ServerDetail
  channelId: string
  /** Editing this one; otherwise a new one. */
  event?: EventItem
  /** A new event's day (YYYY-MM-DD), from the calendar. */
  day?: string | null
  onClose(): void
}): ReactNode {
  const firstStart = event ? new Date(event.starts_at) : defaultStart(day)
  const firstEnd = event ? new Date(event.ends_at) : new Date(firstStart.getTime() + 2 * HOUR)
  const [title, setTitle] = useState(event?.title ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [start, setStart] = useState(toLocalInput(firstStart))
  const [end, setEnd] = useState(toLocalInput(firstEnd))
  const [repeat, setRepeat] = useState<Repeat>(event?.repeat ?? 'none')
  const rooms = server.channels.filter((c) => c.type === 'voice')
  const [place, setPlace] = useState<PlaceKind>(event?.location_channel_id ? 'room' : event?.location_text ? 'text' : 'none')
  const [roomId, setRoomId] = useState(event?.location_channel_id ?? rooms[0]?.id ?? '')
  const [placeText, setPlaceText] = useState(event?.location_text ?? '')
  const [cover, setCover] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function changeStart(value: string): void {
    // Keeps the length when the start moves.
    const length = new Date(end).getTime() - new Date(start).getTime()
    setStart(value)
    if (value && length > 0) setEnd(toLocalInput(new Date(new Date(value).getTime() + length)))
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!title.trim()) return setError('Dê um nome ao evento.')
    const startsAt = new Date(start)
    const endsAt = new Date(end)
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return setError('Escolha o início e o fim.')
    if (endsAt <= startsAt) return setError('O fim precisa ser depois do início.')
    if (place === 'text' && !placeText.trim()) return setError('Escreva o lugar, ou escolha "Nenhum".')
    const fields: EventFields = {
      title: title.trim(),
      description: description.trim(),
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      // An event keeps the zone it was created in, unless its start is picked again here.
      timezone: event && start === toLocalInput(firstStart) ? event.timezone : localZone(),
      repeat,
      location_channel_id: place === 'room' && roomId ? roomId : null,
      location_text: place === 'text' ? placeText.trim() : null
    }
    setBusy(true)
    setError(null)
    const store = useEvents.getState()
    try {
      const saved = event ? await store.update(channelId, event.id, fields) : await store.create(channelId, fields)
      if (cover) await store.setCover(channelId, saved.id, cover)
      onClose()
    } catch (err) {
      setBusy(false)
      setError(failure(err))
    }
  }

  return (
    <Modal title={event ? 'Editar evento' : 'Criar evento'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className={labelClass}>Nome</span>
          <input autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Noite de jogos" className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>Começa</span>
            <input type="datetime-local" value={start} onChange={(e) => changeStart(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Termina</span>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="block">
          <span className={labelClass}>Repetir</span>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} className={inputClass}>
            <option value="none">Não repete</option>
            <option value="weekly">Toda semana</option>
          </select>
        </label>
        <div>
          <span className={labelClass}>Onde</span>
          <Segmented<PlaceKind>
            options={[
              { value: 'none', label: 'Nenhum' },
              { value: 'room', label: 'Sala de voz' },
              { value: 'text', label: 'Outro lugar' }
            ]}
            value={place}
            onChange={setPlace}
          />
          {place === 'room' &&
            (rooms.length ? (
              <select aria-label="Sala de voz" value={roomId} onChange={(e) => setRoomId(e.target.value)} className={cn(inputClass, 'mt-2')}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-2 text-sm text-fg-subtle">Este servidor não tem salas de voz que você veja.</p>
            ))}
          {place === 'text' && (
            <input
              aria-label="Lugar"
              value={placeText}
              maxLength={200}
              onChange={(e) => setPlaceText(e.target.value)}
              placeholder="Casa da Ana, link, endereço…"
              className={cn(inputClass, 'mt-2')}
            />
          )}
        </div>
        <label className="block">
          <span className={labelClass}>Descrição</span>
          <textarea
            value={description}
            maxLength={4000}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="O que vai rolar, o que levar…"
            className={cn(inputClass, 'resize-none')}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Capa (opcional)</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => setCover(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-fg-muted file:mr-3 file:rounded-control file:border-0 file:bg-elevated file:px-3 file:py-1.5 file:text-fg"
          />
        </label>
        <FormError message={error} />
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Salvando…' : event ? 'Salvar' : 'Criar evento'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}
