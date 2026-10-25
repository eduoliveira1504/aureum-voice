import { CalendarDays, MapPin, Volume2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { fetchMedia, type ServerDetail } from '../../lib/api'
import { coverUrl, type EventItem } from './store'

const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short' })

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString()

/** "hoje", "amanhã" or "sáb., 27 de out." in the user's own zone. */
export function dayLabel(date: Date, now = new Date()): string {
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (sameDay(date, now)) return 'hoje'
  if (sameDay(date, tomorrow)) return 'amanhã'
  return dayFmt.format(date)
}

export const timeLabel = (date: Date): string => timeFmt.format(date)

/** "hoje · 20:00–22:00", or with the end's day when it ends on another one. */
export function whenLabel(startsAt: string, endsAt: string, now = new Date()): string {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  const until = sameDay(start, end) ? timeLabel(end) : `${dayLabel(end, now)}, ${timeLabel(end)}`
  return `${dayLabel(start, now)} · ${timeLabel(start)}–${until}`
}

export function isHappening(event: EventItem, now = Date.now()): boolean {
  return !event.cancelled_at && new Date(event.occurrence.starts_at).getTime() <= now && now < new Date(event.occurrence.ends_at).getTime()
}

/** The calendar-page block: month above, day below. */
export function DateBlock({ iso, muted = false }: { iso: string; muted?: boolean }): ReactNode {
  const date = new Date(iso)
  return (
    <span
      className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-item border border-line ${muted ? 'bg-elevated text-fg-subtle' : 'bg-accent/15 text-accent-text'}`}
    >
      <span className="text-[10px] font-semibold uppercase leading-none">{monthFmt.format(date).replace('.', '')}</span>
      <span className="font-display text-lg font-bold leading-tight">{date.getDate()}</span>
    </span>
  )
}

/** Where: the voice room (by its name here) or the text. */
export function Place({ event, server }: { event: EventItem; server: ServerDetail }): ReactNode {
  if (event.location_channel_id) {
    const room = server.channels.find((c) => c.id === event.location_channel_id)
    return (
      <span className="flex min-w-0 items-center gap-1">
        <Volume2 size={14} className="shrink-0" />
        <span className="truncate">{room?.name ?? 'sala de voz'}</span>
      </span>
    )
  }
  if (event.location_text) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <MapPin size={14} className="shrink-0" />
        <span className="truncate">{event.location_text}</span>
      </span>
    )
  }
  return null
}

const covers = new Map<string, Promise<string>>()

/** The event's cover (fetched with the token), or a plain band. */
export function Cover({ channelId, event, className = '' }: { channelId: string; event: EventItem; className?: string }): ReactNode {
  const url = coverUrl(channelId, event)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (url) {
      let pending = covers.get(url)
      if (!pending) {
        pending = fetchMedia(url).then((blob) => URL.createObjectURL(blob))
        pending.catch(() => covers.delete(url!))
        covers.set(url, pending)
      }
      void pending.then((s) => alive && setSrc(s), () => alive && setSrc(null))
    } else setSrc(null)
    return () => {
      alive = false
    }
  }, [url])
  if (!url) return null
  return (
    <span className={`flex items-center justify-center overflow-hidden bg-elevated ${className}`}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <CalendarDays size={28} className="text-fg-subtle" />}
    </span>
  )
}

/** "3 vão · 1 talvez" */
export function countLabel(event: EventItem): string {
  const going = event.responses.going.length
  const maybe = event.responses.maybe.length
  const parts = [going === 1 ? '1 vai' : `${going} vão`]
  if (maybe) parts.push(`${maybe} talvez`)
  return parts.join(' · ')
}
