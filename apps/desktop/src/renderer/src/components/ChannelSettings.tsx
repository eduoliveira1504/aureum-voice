import { Check, Minus, Plus, X } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'

import { addonModule } from '../addons/registry'
import type { AddonModule } from '../addons/types'
import { api, ApiError, type Channel, type Override, type ServerDetail } from '../lib/api'
import { channelPermissions, has, outranks, Perm, PERM_INFO, rankOf, type PermName } from '../lib/permissions'
import { useChat } from '../store/chat'
import { FormError, Modal } from './Modal'
import { Avatar, Field, menuClass, PrimaryButton, useDismiss } from './ui'

const COMMON: PermName[] = ['VIEW_CHANNEL', 'MANAGE_CHANNELS', 'MANAGE_ROLES', 'CREATE_INVITE']
const TEXT: PermName[] = ['SEND_MESSAGES', 'READ_HISTORY', 'MANAGE_MESSAGES', 'ATTACH_FILES', 'ADD_REACTIONS', 'MENTION_EVERYONE']
const VOICE: PermName[] = ['CONNECT', 'SPEAK', 'VIDEO', 'STREAM', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS']
const ADDON: PermName[] = ['SEND_MESSAGES', 'MANAGE_ADDONS']

/** How a permission reads in an addon channel, where it's not about messages or rooms. */
const ADDON_LABELS: Partial<Record<PermName, { label: string; description: string }>> = {
  SEND_MESSAGES: { label: 'Participar', description: 'Mexer no conteúdo do addon (editar a página, mover cards...).' },
  MANAGE_ADDONS: { label: 'Gerenciar addon', description: 'Mudar as configurações do addon e, com Gerenciar canais, excluí-lo.' }
}

function permNames(channel: Channel): PermName[] {
  return [...COMMON, ...(channel.type === 'voice' ? VOICE : channel.type === 'addon' ? ADDON : TEXT)]
}

function errorText(err: unknown): string {
  return err instanceof ApiError && err.status === 403 ? 'Você não tem permissão para isso.' : 'Não foi possível salvar.'
}

type Tab = 'general' | 'addon' | 'permissions'

export function ChannelSettingsModal({
  server,
  channel,
  meId,
  onClose
}: {
  server: ServerDetail
  channel: Channel
  meId: string
  onClose(): void
}): ReactNode {
  const perms = channelPermissions(server, channel, meId)
  const addon = channel.type === 'addon' ? addonModule(channel.addon_key) : undefined
  const tabs = (
    [
      ['general', 'Geral', has(perms, Perm.MANAGE_CHANNELS)],
      ['addon', 'Addon', !!addon?.Settings && has(perms, Perm.MANAGE_ADDONS)],
      ['permissions', 'Permissões', has(perms, Perm.MANAGE_ROLES)]
    ] as const
  ).filter(([, , allowed]) => allowed)
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'general')
  const prefix = channel.type === 'text' ? '#' : ''

  return (
    <Modal title={`${prefix}${channel.name}`} wide onClose={onClose}>
      <div className="mb-5 flex gap-1 border-b border-line">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {tab === 'general' && <GeneralTab channel={channel} />}
        {tab === 'addon' && addon?.Settings && <AddonTab channel={channel} Settings={addon.Settings} />}
        {tab === 'permissions' && <PermissionsTab server={server} channel={channel} meId={meId} />}
      </div>
    </Modal>
  )
}

function GeneralTab({ channel }: { channel: Channel }): ReactNode {
  const [name, setName] = useState(channel.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api(`/channels/${channel.id}`, { method: 'PATCH', body: { name: name.trim() } })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex max-w-[520px] items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) void save()
      }}
    >
      <div className="flex-1 space-y-3">
        <FormError message={error} />
        <Field label="Nome do canal" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="w-32">
        <PrimaryButton type="submit" disabled={busy || !name.trim() || name.trim() === channel.name}>
          Salvar
        </PrimaryButton>
      </div>
    </form>
  )
}

/** The addon's own settings form, saved as the channel's config. */
function AddonTab({ channel, Settings }: { channel: Channel; Settings: NonNullable<AddonModule['Settings']> }): ReactNode {
  const [config, setConfig] = useState(channel.config)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(config) !== JSON.stringify(channel.config)

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api(`/channels/${channel.id}`, { method: 'PATCH', body: { config } })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-[520px] space-y-3">
      <FormError message={error} />
      <Settings config={config} onChange={setConfig} />
      <div className="w-32">
        <PrimaryButton type="button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Salvando…' : 'Salvar'}
        </PrimaryButton>
      </div>
    </div>
  )
}

interface Target {
  type: 'role' | 'member'
  id: string
  name: string
  color?: string | null
  avatar?: string | null
  /** Its rank (role position or member's highest role), to check the hierarchy. */
  rank: number
}

function PermissionsTab({ server, channel, meId }: { server: ServerDetail; channel: Channel; meId: string }): ReactNode {
  const everyone: Target = { type: 'role', id: server.id, name: '@everyone', rank: 0 }
  const targetOf = (o: Pick<Override, 'target_type' | 'target_id'>): Target | null => {
    if (o.target_type === 'role') {
      if (o.target_id === server.id) return everyone
      const role = server.roles.find((r) => r.id === o.target_id)
      return role ? { type: 'role', id: role.id, name: role.name, color: role.color, rank: role.position } : null
    }
    const member = server.members.find((m) => m.user.id === o.target_id)
    return member
      ? { type: 'member', id: member.user.id, name: member.user.display_name, avatar: member.user.avatar_url, rank: rankOf(server, member.user.id) }
      : null
  }
  const listed: Target[] = [
    everyone,
    ...channel.overrides
      .filter((o) => !(o.target_type === 'role' && o.target_id === server.id))
      .map(targetOf)
      .filter((t): t is Target => t !== null)
  ]
  const [extra, setExtra] = useState<Target[]>([]) // picked, not saved yet
  const targets = [...listed, ...extra.filter((t) => !listed.some((l) => l.id === t.id))]
  const [selected, setSelected] = useState<string>(server.id)
  const target = targets.find((t) => t.id === selected) ?? everyone
  const override = channel.overrides.find((o) => o.target_type === target.type && o.target_id === target.id)

  const candidates: Target[] = [
    ...server.roles
      .filter((r) => r.id !== server.id)
      .map((r): Target => ({ type: 'role', id: r.id, name: r.name, color: r.color, rank: r.position })),
    ...server.members.map(
      (m): Target => ({ type: 'member', id: m.user.id, name: m.user.display_name, avatar: m.user.avatar_url, rank: rankOf(server, m.user.id) })
    )
  ].filter((t) => !targets.some((x) => x.id === t.id) && outranks(server, meId, t.rank))

  return (
    <div className="grid grid-cols-[200px_1fr] gap-5">
      <div className="space-y-1">
        <AddTarget
          candidates={candidates}
          onPick={(t) => {
            setExtra((x) => [...x, t])
            setSelected(t.id)
          }}
        />
        {targets.map((t) => (
          <button
            key={`${t.type}:${t.id}`}
            type="button"
            onClick={() => setSelected(t.id)}
            className={`flex w-full items-center gap-2 rounded-item px-2 py-1.5 text-left text-sm ${
              t.id === target.id ? 'bg-elevated text-fg' : 'text-fg-muted hover:bg-elevated/60 hover:text-fg'
            }`}
          >
            <TargetIcon target={t} />
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
          </button>
        ))}
      </div>
      <OverrideEditor
        key={`${target.type}:${target.id}:${override?.allow ?? 0}:${override?.deny ?? 0}`}
        server={server}
        channel={channel}
        meId={meId}
        target={target}
        override={override}
        onRemoved={() => {
          setExtra((x) => x.filter((t) => t.id !== target.id))
          setSelected(server.id)
        }}
      />
    </div>
  )
}

function TargetIcon({ target }: { target: Target }): ReactNode {
  if (target.type === 'member') return <Avatar name={target.name} url={target.avatar} size={18} />
  return (
    <span
      style={{ background: target.color ?? undefined }}
      className={`inline-block h-3 w-3 shrink-0 rounded-full ${target.color ? '' : 'bg-fg-subtle'}`}
    />
  )
}

function AddTarget({ candidates, onPick }: { candidates: Target[]; onPick(t: Target): void }): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  return (
    <div ref={ref} className="relative mb-2">
      <button
        type="button"
        disabled={candidates.length === 0}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1.5 rounded-control border border-dashed border-line py-2 text-sm font-medium text-fg-muted hover:border-accent hover:text-fg disabled:opacity-50"
      >
        <Plus size={16} /> Cargo ou membro
      </button>
      {open && (
        <div className={`${menuClass} absolute left-0 right-0 top-11 max-h-64 overflow-y-auto`}>
          {candidates.map((t) => (
            <button
              key={`${t.type}:${t.id}`}
              type="button"
              onClick={() => {
                setOpen(false)
                onPick(t)
              }}
              className="flex w-full items-center gap-2 rounded-item px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-elevated hover:text-fg"
            >
              <TargetIcon target={t} />
              <span className="truncate">{t.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type State = 'deny' | 'inherit' | 'allow'

function OverrideEditor({
  server,
  channel,
  meId,
  target,
  override,
  onRemoved
}: {
  server: ServerDetail
  channel: Channel
  meId: string
  target: Target
  override: Override | undefined
  onRemoved(): void
}): ReactNode {
  const [allow, setAllow] = useState(override?.allow ?? 0)
  const [deny, setDeny] = useState(override?.deny ?? 0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const myPerms = channelPermissions(server, channel, meId)
  const editable = target.id === server.id || outranks(server, meId, target.rank)
  const dirty = allow !== (override?.allow ?? 0) || deny !== (override?.deny ?? 0)
  const names = permNames(channel)

  const stateOf = (bit: number): State => (has(allow, bit) ? 'allow' : has(deny, bit) ? 'deny' : 'inherit')
  const set = (bit: number, state: State): void => {
    setAllow((a) => (state === 'allow' ? a | bit : a & ~bit))
    setDeny((d) => (state === 'deny' ? d | bit : d & ~bit))
  }

  async function send(action: () => Promise<unknown>, after?: () => void): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
      await useChat.getState().refreshServer(server.id)
      after?.()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const path = `/channels/${channel.id}/overrides/${target.type}/${target.id}`

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm text-fg-muted">
        {target.id === server.id
          ? 'Vale para todo mundo neste canal. Negar "Ver canais" aqui deixa o canal privado; depois libere para os cargos certos.'
          : `Muda o que ${target.type === 'role' ? 'quem tem esse cargo' : 'essa pessoa'} pode fazer só neste canal.`}
      </p>
      {!editable && (
        <p className="rounded-control border border-line bg-main px-3 py-2 text-sm text-fg-muted">Está no seu nível ou acima: só dá pra ver.</p>
      )}
      <FormError message={error} />
      <div className="space-y-1.5">
        {names.map((name) => {
          const bit = Perm[name]
          const info = (channel.type === 'addon' && ADDON_LABELS[name]) || PERM_INFO[name]
          // Nobody grants (or denies) a permission they don't have here.
          const allowed = editable && has(myPerms, bit)
          return (
            <div key={name} className={`flex items-center justify-between gap-4 rounded-control border border-line bg-main px-3 py-2 ${allowed ? '' : 'opacity-60'}`}>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{name === 'MANAGE_ROLES' ? 'Gerenciar permissões' : info.label}</span>
                {info.description && <span className="block text-xs text-fg-subtle">{info.description}</span>}
              </span>
              <TriState value={stateOf(bit)} disabled={!allowed} onChange={(s) => set(bit, s)} label={info.label} />
            </div>
          )
        })}
      </div>
      {editable && (
        <div className="sticky bottom-0 flex items-center gap-3 bg-panel py-3">
          <div className="w-36">
            <PrimaryButton type="button" disabled={!dirty || busy} onClick={() => void send(() => api(path, { method: 'PUT', body: { allow, deny } }))}>
              {busy ? 'Salvando…' : 'Salvar'}
            </PrimaryButton>
          </div>
          {override && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(() => api(path, { method: 'DELETE' }), onRemoved)}
              className="ml-auto text-sm font-medium text-danger hover:underline"
            >
              Remover ajustes
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const STATES: { value: State; label: string; icon: typeof Check; tone: string }[] = [
  { value: 'deny', label: 'Negar', icon: X, tone: 'bg-danger text-on-danger' },
  { value: 'inherit', label: 'Herdar', icon: Minus, tone: 'bg-elevated text-fg' },
  { value: 'allow', label: 'Permitir', icon: Check, tone: 'bg-success/25 text-success' }
]

function TriState({ value, disabled, onChange, label }: { value: State; disabled: boolean; onChange(s: State): void; label: string }): ReactNode {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 overflow-hidden rounded-item border border-line">
      {STATES.map(({ value: v, label: l, icon: Icon, tone }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          title={l}
          aria-label={l}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={`flex h-7 w-8 items-center justify-center disabled:cursor-not-allowed ${value === v ? tone : 'text-fg-subtle enabled:hover:text-fg'}`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}

