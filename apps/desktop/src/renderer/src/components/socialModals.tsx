import { Check, Phone, Search } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { ApiError } from '../lib/api'
import { useNav } from '../store/nav'
import { dmTitle, useSocial } from '../store/social'
import { FormError, Modal } from './Modal'
import { cn, Field, GroupAvatar, inputClass, PresenceAvatar, PrimaryButton } from './ui'
import { t } from '../lib/i18n'

const MAX_GROUP = 10

function socialError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return t('people.social.friendsOnly')
    if (typeof err.detail === 'string' && err.detail.startsWith('Groups hold')) return t('people.social.groupMax', { count: MAX_GROUP })
  }
  return err instanceof TypeError ? t('server.join.unreachable') : fallback
}

/**
 * Picks friends: for a new group, or to add people to a group or call. `taken` are already in
 * (they count toward the 10-person limit and aren't listed).
 */
export function PickFriendsModal({
  title,
  subtitle,
  confirmLabel,
  taken = [],
  withName = false,
  onConfirm,
  onClose
}: {
  title: string
  subtitle?: string
  confirmLabel: string
  taken?: string[]
  /** Also asks for a (optional) group name. */
  withName?: boolean
  onConfirm(userIds: string[], name: string): Promise<void>
  onClose(): void
}): ReactNode {
  const friends = useSocial((s) => s.friends)
  const presence = useSocial((s) => s.presence)
  const [picked, setPicked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const room = MAX_GROUP - Math.max(1, taken.length) // the group always includes you
  const q = query.trim().toLowerCase()
  const list = Object.values(friends)
    .filter((f) => f.kind === 'friend' && !taken.includes(f.user.id))
    .filter((f) => !q || f.user.display_name.toLowerCase().includes(q) || f.user.username.includes(q))
    .sort((a, b) => a.user.display_name.localeCompare(b.user.display_name))

  const toggle = (id: string): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < room ? [...p, id] : p))

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!picked.length) return setError(t('people.social.pickOne'))
    setBusy(true)
    setError(null)
    try {
      await onConfirm(picked, name.trim())
      onClose()
    } catch (err) {
      setError(socialError(err, t('sounds.error')))
      setBusy(false)
    }
  }

  return (
    <Modal title={title} subtitle={subtitle ?? t('people.social.room', { count: room - picked.length })} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        {withName && (
          <Field label={t('people.social.groupName')} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={t('people.social.groupPlaceholder')} />
        )}
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('people.social.searchFriends')}
            aria-label={t('people.social.searchFriends')}
            className={cn(inputClass, 'pl-9')}
          />
        </label>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {list.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-subtle">
              {Object.values(friends).some((f) => f.kind === 'friend') ? t('people.social.nobody') : t('people.social.addFirst')}
            </p>
          )}
          {list.map((f) => {
            const on = picked.includes(f.user.id)
            return (
              <button
                key={f.user.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(f.user.id)}
                className={`flex w-full items-center gap-3 rounded-item px-2 py-1.5 text-left ${on ? 'bg-accent/10' : 'hover:bg-elevated'}`}
              >
                <PresenceAvatar name={f.user.display_name} url={f.user.avatar_url} gif={f.user.avatar_gif} status={presence[f.user.id] ?? f.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.user.display_name}</span>
                  <span className="block truncate text-xs text-fg-subtle">@{f.user.username}</span>
                </span>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border ${on ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}
                >
                  {on && <Check size={14} />}
                </span>
              </button>
            )
          })}
        </div>
        <PrimaryButton type="submit" disabled={busy || picked.length === 0}>
          {busy ? t('auth.wait') : confirmLabel}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

export function RenameGroupModal({ id, current, onClose }: { id: string; current: string | null; onClose(): void }): ReactNode {
  const renameGroup = useSocial((s) => s.renameGroup)
  const [name, setName] = useState(current ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    try {
      await renameGroup(id, name.trim() || null)
      onClose()
    } catch (err) {
      setError(socialError(err, t('people.social.renameFailed')))
      setBusy(false)
    }
  }

  return (
    <Modal title={t('people.social.renameTitle')} subtitle={t('people.social.renameHint')} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        <Field autoFocus label={t('people.social.name')} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </PrimaryButton>
      </form>
    </Modal>
  )
}


function requestError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return t('people.social.noUser')
    if (err.status === 400) return t('people.social.yourself')
    if (err.status === 403) return t('people.social.cantRequest')
    if (err.status === 429) return t('people.social.tooMany')
    if (err.status === 409) return err.detail === 'Unblock this user first' ? t('people.social.unblockFirst') : t('people.social.alreadyFriends')
  }
  return err instanceof TypeError ? t('server.join.unreachable') : t('sounds.error')
}

/** Sends a friend request by @username: a page of its own in Amigos, or the body of a modal (`bare`). */
export function AddFriend({ bare = false }: { bare?: boolean }): ReactNode {
  const sendRequest = useSocial((s) => s.sendRequest)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const username = value.trim().replace(/^@/, '')
    if (!username) return
    setBusy(true)
    try {
      const friend = await sendRequest(username)
      setResult({
        ok: true,
        text:
          friend.kind === 'friend'
            ? t('people.social.nowFriends', { name: friend.user.display_name })
            : t('people.social.sentTo', { name: friend.user.display_name })
      })
      setValue('')
    } catch (err) {
      setResult({ ok: false, text: requestError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={bare ? '' : 'px-6 py-6'}>
      {!bare && (
        <>
          <h3 className="font-display text-lg font-semibold">{t('people.social.addFriend')}</h3>
          <p className="mt-1 text-sm text-fg-muted">{t('people.social.addHint')}</p>
        </>
      )}
      <form
        onSubmit={submit}
        className={`${bare ? '' : 'mt-4 '}flex items-center gap-2 rounded-control border bg-elevated p-1.5 pl-3 focus-within:ring-2 focus-within:ring-accent/25 ${
          result ? (result.ok ? 'border-success' : 'border-danger') : 'border-line focus-within:border-accent'
        }`}
      >
        <span className="text-fg-subtle">@</span>
        <input
          autoFocus
          value={value}
          maxLength={33}
          onChange={(e) => {
            setValue(e.target.value)
            setResult(null)
          }}
          placeholder={t('people.social.username')}
          aria-label={t('people.social.usernameAria')}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] outline-none placeholder:text-fg-subtle"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('people.social.send')}
        </button>
      </form>
      {result && <p className={`mt-2 text-sm ${result.ok ? 'text-success' : 'text-danger'}`}>{result.text}</p>}
    </div>
  )
}

export function AddFriendModal({ onClose }: { onClose(): void }): ReactNode {
  return (
    <Modal title={t('people.social.addFriend')} subtitle={t('people.social.addHint')} onClose={onClose}>
      <AddFriend bare />
    </Modal>
  )
}

/** "Iniciar chamada" in Home: one friend (their DM) or one of my groups. */
export function StartCallModal({ meId, onClose }: { meId: string; onClose(): void }): ReactNode {
  const friends = useSocial((s) => s.friends)
  const presence = useSocial((s) => s.presence)
  const dms = useSocial((s) => s.dms)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const q = query.trim().toLowerCase()
  const matches = (...names: string[]): boolean => !q || names.some((n) => n.toLowerCase().includes(q))
  const people = Object.values(friends)
    .filter((f) => f.kind === 'friend' && matches(f.user.display_name, f.user.username))
    .sort((a, b) => a.user.display_name.localeCompare(b.user.display_name))
  const groups = Object.values(dms)
    .filter((d) => d.type === 'group_dm' && matches(dmTitle(d, meId)))
    .sort((a, b) => b.last_message_id - a.last_message_id)

  async function call(target: { userId: string } | { channelId: string }): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const social = useSocial.getState()
      const channelId = 'userId' in target ? await social.openDm(target.userId) : target.channelId
      useNav.getState().openHome(channelId)
      await social.startCall(channelId)
      onClose()
    } catch (err) {
      setError(socialError(err, t('people.social.callFailed')))
      setBusy(false)
    }
  }

  const row = 'flex w-full items-center gap-3 rounded-item px-2 py-1.5 text-left hover:bg-elevated disabled:opacity-50'
  return (
    <Modal title={t('people.social.startCall')} subtitle={t('people.social.startCallHint')} onClose={onClose}>
      <div className="space-y-4">
        <FormError message={error} />
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('people.social.searchAll')}
            aria-label={t('people.social.searchAll')}
            className={cn(inputClass, 'pl-9')}
          />
        </label>
        <div className="max-h-80 space-y-0.5 overflow-y-auto">
          {people.length === 0 && groups.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-subtle">{q ? t('people.social.nobody') : t('people.social.addFirst')}</p>
          )}
          {groups.map((d) => (
            <button key={d.id} type="button" disabled={busy} onClick={() => void call({ channelId: d.id })} className={row}>
              <GroupAvatar url={d.icon_url} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{dmTitle(d, meId)}</span>
                <span className="block text-xs text-fg-subtle">{t('people.social.groupPeople', { count: d.members.length })}</span>
              </span>
              <Phone size={16} className="shrink-0 text-fg-subtle" />
            </button>
          ))}
          {people.map((f) => (
            <button key={f.user.id} type="button" disabled={busy} onClick={() => void call({ userId: f.user.id })} className={row}>
              <PresenceAvatar name={f.user.display_name} url={f.user.avatar_url} gif={f.user.avatar_gif} status={presence[f.user.id] ?? f.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.user.display_name}</span>
                <span className="block truncate text-xs text-fg-subtle">@{f.user.username}</span>
              </span>
              <Phone size={16} className="shrink-0 text-fg-subtle" />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
