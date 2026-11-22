/**
 * Search inside a server (block 4.2.4): messages in the channels the user can read, filtered by
 * channel, author and date, newest first. A result opens its channel at the message.
 */

import { Hash, Search, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, type Message, type ServerDetail } from '../lib/api'
import { messagePreview } from '../lib/attachments'
import { orderedChannels } from '../lib/channelOrder'
import { dateFormat } from '../lib/format'
import { memberName } from '../lib/members'
import { roleNameIn } from '../lib/mentions'
import { t } from '../lib/i18n'
import { useChat } from '../store/chat'
import { channelTab, useNav } from '../store/nav'
import { FormError, Modal } from './Modal'
import { Avatar, inputClass, labelClass, PrimaryButton } from './ui'

/** Results per page (the API allows up to 50). */
export const SEARCH_PAGE = 25

interface SearchPage {
  messages: Message[]
  next_before: number | null
}

interface Filters {
  channel: string
  author: string
  /** yyyy-mm-dd, from the date inputs, in the person's own time zone. */
  since: string
  until: string
}

const NO_FILTERS: Filters = { channel: '', author: '', since: '', until: '' }

/** Start of a local day, as the instant the API compares with. */
const dayStart = (day: string, plusDays = 0): string => {
  const date = new Date(`${day}T00:00:00`)
  date.setDate(date.getDate() + plusDays)
  return date.toISOString()
}

export function searchQuery(q: string, filters: Filters, before?: number): string {
  const params = new URLSearchParams({ q: q.trim(), limit: String(SEARCH_PAGE) })
  if (filters.channel) params.set('channel_id', filters.channel)
  if (filters.author) params.set('author_id', filters.author)
  if (filters.since) params.set('since', dayStart(filters.since))
  // "Até" includes the whole day.
  if (filters.until) params.set('until', dayStart(filters.until, 1))
  if (before) params.set('before', String(before))
  return params.toString()
}

function searchError(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) return t('server.search.tooMany')
  return t('server.search.failed')
}

export function ServerSearchModal({ server, onClose }: { server: ServerDetail; onClose(): void }): ReactNode {
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  // What the shown results answer, so "Carregar mais" continues the same search.
  const [searched, setSearched] = useState<{ q: string; filters: Filters } | null>(null)
  const [results, setResults] = useState<Message[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)

  const channels = orderedChannels(server).filter((c) => c.type === 'text' || c.type === 'voice')
  const members = [...server.members].sort((a, b) => memberName(a).localeCompare(memberName(b)))

  async function run(query: string, chosen: Filters, before?: number): Promise<void> {
    const id = ++request.current
    setBusy(true)
    setError(null)
    try {
      const page = await api<SearchPage>(`/servers/${server.id}/search?${searchQuery(query, chosen, before)}`)
      // An older search answering late is dropped.
      if (id !== request.current) return
      setResults((prev) => (before ? [...prev, ...page.messages] : page.messages))
      setNextBefore(page.next_before)
      setSearched({ q: query, filters: chosen })
    } catch (err) {
      if (id === request.current) setError(searchError(err))
    } finally {
      if (id === request.current) setBusy(false)
    }
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!q.trim()) return
    void run(q, filters)
  }

  // Changing a filter searches again with what was typed.
  const setFilter = (next: Partial<Filters>): void => {
    const chosen = { ...filters, ...next }
    setFilters(chosen)
    if (q.trim()) void run(q, chosen)
  }

  // Typing a new search clears results that no longer match it.
  useEffect(() => {
    if (!q.trim()) {
      request.current++
      setSearched(null)
      setResults([])
      setNextBefore(null)
      setBusy(false)
    }
  }, [q])

  const open = (message: Message): void => {
    const nav = useNav.getState()
    nav.openServer(server.id)
    nav.openTab(server.id, channelTab(message.channel_id))
    useChat.getState().focusMessage(message.channel_id, message.id)
    onClose()
  }

  const hasFilters = filters.channel || filters.author || filters.since || filters.until
  const day = dateFormat({ day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <Modal title={t('server.search.title', { server: server.name })} wide tall onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t('server.search.placeholder')}</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input
              autoFocus
              type="search"
              value={q}
              maxLength={200}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('server.search.placeholder')}
              className={`${inputClass} pl-9`}
            />
          </label>
          <div className="w-28 shrink-0">
            <PrimaryButton type="submit" disabled={!q.trim() || busy}>
              {t('server.search.submit')}
            </PrimaryButton>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="block min-w-0">
            <span className={labelClass}>{t('server.search.channel')}</span>
            <select value={filters.channel} onChange={(e) => setFilter({ channel: e.target.value })} className={inputClass}>
              <option value="">{t('server.search.anyChannel')}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.type === 'text' ? `#${c.name}` : c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className={labelClass}>{t('server.search.author')}</span>
            <select value={filters.author} onChange={(e) => setFilter({ author: e.target.value })} className={inputClass}>
              <option value="">{t('server.search.anyAuthor')}</option>
              {members.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {memberName(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className={labelClass}>{t('server.search.since')}</span>
            <input type="date" value={filters.since} max={filters.until || undefined} onChange={(e) => setFilter({ since: e.target.value })} className={inputClass} />
          </label>
          <label className="block min-w-0">
            <span className={labelClass}>{t('server.search.until')}</span>
            <input type="date" value={filters.until} min={filters.since || undefined} onChange={(e) => setFilter({ until: e.target.value })} className={inputClass} />
          </label>
        </div>
        {hasFilters && (
          <button type="button" onClick={() => setFilter(NO_FILTERS)} className="text-sm text-accent-text hover:underline">
            {t('server.search.clear')}
          </button>
        )}
      </form>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1" aria-live="polite">
        <FormError message={error} />
        {!searched && !busy && !error && <p className="py-6 text-center text-sm text-fg-muted">{t('server.search.empty')}</p>}
        {searched && results.length === 0 && !busy && !error && (
          <p className="py-6 text-center text-sm text-fg-muted">{t('server.search.none')}</p>
        )}
        <ul className="space-y-1">
          {results.map((message) => {
            const channel = server.channels.find((c) => c.id === message.channel_id)
            const member = server.members.find((m) => m.user.id === message.author?.id)
            const name = member ? memberName(member) : (message.author?.display_name ?? t('server.search.someone'))
            return (
              <li key={message.id}>
                <button
                  type="button"
                  onClick={() => open(message)}
                  className="flex w-full items-start gap-3 rounded-control px-3 py-2 text-left hover:bg-elevated"
                >
                  <Avatar name={name} url={message.author?.avatar_url} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2 text-sm">
                      <span className="truncate font-semibold">{name}</span>
                      <span className="flex shrink-0 items-center gap-0.5 text-xs text-fg-subtle">
                        {channel?.type === 'voice' ? <Volume2 size={12} /> : <Hash size={12} />}
                        {channel?.name}
                      </span>
                      <span className="shrink-0 text-xs text-fg-subtle">{day.format(new Date(message.created_at))}</span>
                    </span>
                    <span className="line-clamp-3 block text-sm wrap-anywhere text-fg-muted">{messagePreview(message, roleNameIn([server]))}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {busy && <p className="py-3 text-center text-sm text-fg-muted">{t('common.loading')}</p>}
        {searched && nextBefore !== null && !busy && (
          <div className="py-3 text-center">
            <button
              type="button"
              onClick={() => void run(searched.q, searched.filters, nextBefore)}
              className="rounded-control border border-line px-4 py-1.5 text-sm font-medium text-fg-muted hover:bg-elevated hover:text-fg"
            >
              {t('server.search.more')}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
