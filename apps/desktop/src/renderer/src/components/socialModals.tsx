import { Check, Phone, Search } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { ApiError } from '../lib/api'
import { useNav } from '../store/nav'
import { dmTitle, useSocial } from '../store/social'
import { FormError, Modal } from './Modal'
import { cn, Field, GroupAvatar, inputClass, PresenceAvatar, PrimaryButton } from './ui'

const MAX_GROUP = 10

function socialError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'Só dá pra fazer isso com amigos.'
    if (typeof err.detail === 'string' && err.detail.startsWith('Groups hold')) return `Grupos têm no máximo ${MAX_GROUP} pessoas.`
  }
  return err instanceof TypeError ? 'Não foi possível conectar ao servidor.' : fallback
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
    if (!picked.length) return setError('Escolha pelo menos um amigo.')
    setBusy(true)
    setError(null)
    try {
      await onConfirm(picked, name.trim())
      onClose()
    } catch (err) {
      setError(socialError(err, 'Algo deu errado. Tente de novo.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={title} subtitle={subtitle ?? `Você pode escolher mais ${room - picked.length}.`} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        {withName && (
          <Field label="Nome do grupo (opcional)" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Squad da sexta" />
        )}
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar amigos"
            aria-label="Buscar amigos"
            className={cn(inputClass, 'pl-9')}
          />
        </label>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {list.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-subtle">
              {Object.values(friends).some((f) => f.kind === 'friend') ? 'Ninguém com esse nome.' : 'Adicione amigos primeiro.'}
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
                <PresenceAvatar name={f.user.display_name} url={f.user.avatar_url} status={presence[f.user.id] ?? f.status} />
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
          {busy ? 'Aguarde…' : confirmLabel}
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
      setError(socialError(err, 'Não foi possível renomear o grupo.'))
      setBusy(false)
    }
  }

  return (
    <Modal title="Renomear grupo" subtitle="Deixe vazio para usar os nomes das pessoas." onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        <Field autoFocus label="Nome do grupo" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

const ADD_FRIEND_HINT = 'Digite o @username da pessoa. Ela precisa aceitar o pedido.'

function requestError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Ninguém com esse username.'
    if (err.status === 400) return 'Esse é você.'
    if (err.status === 403) return 'Não dá pra enviar um pedido para essa pessoa.'
    if (err.status === 429) return 'Muitos pedidos seguidos. Tente de novo mais tarde.'
    if (err.status === 409) return err.detail === 'Unblock this user first' ? 'Desbloqueie essa pessoa primeiro.' : 'Vocês já são amigos.'
  }
  return err instanceof TypeError ? 'Não foi possível conectar ao servidor.' : 'Algo deu errado. Tente de novo.'
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
            ? `Você e ${friend.user.display_name} agora são amigos.`
            : `Pedido enviado para ${friend.user.display_name}.`
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
          <h3 className="font-display text-lg font-semibold">Adicionar amigo</h3>
          <p className="mt-1 text-sm text-fg-muted">{ADD_FRIEND_HINT}</p>
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
          placeholder="username"
          aria-label="Username"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] outline-none placeholder:text-fg-subtle"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar pedido
        </button>
      </form>
      {result && <p className={`mt-2 text-sm ${result.ok ? 'text-success' : 'text-danger'}`}>{result.text}</p>}
    </div>
  )
}

export function AddFriendModal({ onClose }: { onClose(): void }): ReactNode {
  return (
    <Modal title="Adicionar amigo" subtitle={ADD_FRIEND_HINT} onClose={onClose}>
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
      setError(socialError(err, 'Não foi possível iniciar a chamada.'))
      setBusy(false)
    }
  }

  const row = 'flex w-full items-center gap-3 rounded-item px-2 py-1.5 text-left hover:bg-elevated disabled:opacity-50'
  return (
    <Modal title="Iniciar chamada" subtitle="Ligue pra um amigo ou um grupo." onClose={onClose}>
      <div className="space-y-4">
        <FormError message={error} />
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar amigos e grupos"
            aria-label="Buscar amigos e grupos"
            className={cn(inputClass, 'pl-9')}
          />
        </label>
        <div className="max-h-80 space-y-0.5 overflow-y-auto">
          {people.length === 0 && groups.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-subtle">{q ? 'Ninguém com esse nome.' : 'Adicione amigos primeiro.'}</p>
          )}
          {groups.map((d) => (
            <button key={d.id} type="button" disabled={busy} onClick={() => void call({ channelId: d.id })} className={row}>
              <GroupAvatar url={d.icon_url} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{dmTitle(d, meId)}</span>
                <span className="block text-xs text-fg-subtle">Grupo · {d.members.length} pessoas</span>
              </span>
              <Phone size={16} className="shrink-0 text-fg-subtle" />
            </button>
          ))}
          {people.map((f) => (
            <button key={f.user.id} type="button" disabled={busy} onClick={() => void call({ userId: f.user.id })} className={row}>
              <PresenceAvatar name={f.user.display_name} url={f.user.avatar_url} status={presence[f.user.id] ?? f.status} />
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
