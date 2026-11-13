import { Check, Minus, Plus, X } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'

import { addonModule } from '../addons/registry'
import type { AddonModule } from '../addons/types'
import { api, ApiError, type Category, type Channel, type Override, type ServerDetail } from '../lib/api'
import { channelPermissions, has, outranks, Perm, PERM_INFO, rankOf, type PermName } from '../lib/permissions'
import { useChat } from '../store/chat'
import { FormError, Modal, ModalBody, ModalTabs, SecondaryButton } from './Modal'
import { Avatar, Field, inputClass, labelClass, menuClass, PrimaryButton, useDismiss } from './ui'
import { t } from '../lib/i18n'

const COMMON: PermName[] = ['VIEW_CHANNEL', 'MANAGE_CHANNELS', 'MANAGE_ROLES', 'CREATE_INVITE']
const TEXT: PermName[] = ['SEND_MESSAGES', 'READ_HISTORY', 'MANAGE_MESSAGES', 'ATTACH_FILES', 'ADD_REACTIONS', 'MENTION_EVERYONE']
const VOICE: PermName[] = ['CONNECT', 'SPEAK', 'VIDEO', 'STREAM', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS']

/** How a permission reads in an addon channel, where it's not about messages or rooms. */
const addonLabel = (perm: 'SEND_MESSAGES' | 'MANAGE_ADDONS'): { label: string; description: string } => ({
  label: t(`permissions.addon.${perm}.label`),
  description: t(`permissions.addon.${perm}.description`)
})
const ADDON_LABELS: Partial<Record<PermName, { readonly label: string; readonly description: string }>> = {
  get SEND_MESSAGES() {
    return addonLabel('SEND_MESSAGES')
  },
  get MANAGE_ADDONS() {
    return addonLabel('MANAGE_ADDONS')
  }
}

/** What an override can change in this channel, in titled sections. An addon channel shows its
 * addon's own permissions (Participar for the ones that don't declare any). */
/** A category edits with the channel editor: it has no type of its own, so it lists every kind. */
const CATEGORY_TYPE = 'category'

export const categoryAsChannel = (category: Category): Channel =>
  ({ ...category, type: CATEGORY_TYPE, addon_key: null, config: {} }) as unknown as Channel

function permSections(channel: Channel): { title: string; names: PermName[] }[] {
  if ((channel.type as string) === CATEGORY_TYPE) {
    return [
      { title: t('permissions.groups.channel'), names: COMMON },
      { title: t('permissions.groups.text'), names: TEXT },
      { title: t('permissions.groups.voice'), names: VOICE }
    ]
  }
  const own =
    channel.type === 'voice'
      ? { title: t('permissions.groups.voice'), names: VOICE }
      : channel.type === 'addon'
        ? { title: t('permissions.groups.addons'), names: [...(addonModule(channel.addon_key)?.permissions ?? ['SEND_MESSAGES']), 'MANAGE_ADDONS'] as PermName[] }
        : { title: t('permissions.groups.text'), names: TEXT }
  return [{ title: t('permissions.groups.channel'), names: COMMON }, own]
}

function errorText(err: unknown): string {
  return err instanceof ApiError && err.status === 403 ? t('server.forbidden') : t('server.saveFailed')
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
      ['general', t('server.channel.tabs.general'), has(perms, Perm.MANAGE_CHANNELS)],
      ['addon', t('server.channel.tabs.addon'), !!(addon?.Settings || addon?.announces) && has(perms, Perm.MANAGE_ADDONS)],
      ['permissions', t('server.channel.tabs.permissions'), has(perms, Perm.MANAGE_ROLES)]
    ] as const
  ).filter(([, , allowed]) => allowed)
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'general')
  const prefix = channel.type === 'text' ? '#' : ''

  return (
    <Modal title={`${prefix}${channel.name}`} wide onClose={onClose}>
      <ModalTabs<Tab> tabs={tabs} isCurrent={(key) => tab === key} onSelect={setTab} />
      <ModalBody>
        {tab === 'general' && <GeneralTab channel={channel} />}
        {tab === 'addon' && addon && <AddonTab server={server} channel={channel} addon={addon} />}
        {tab === 'permissions' && (
          <div className="space-y-4">
            <SyncNotice server={server} channel={channel} />
            <PermissionsEditor server={server} channel={channel} meId={meId} path={`/channels/${channel.id}/overrides`} place={t('server.channel.here')} />
          </div>
        )}
      </ModalBody>
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
        <Field label={t('server.channel.name')} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="w-32">
        <PrimaryButton type="submit" disabled={busy || !name.trim() || name.trim() === channel.name}>
          {t('common.save')}
        </PrimaryButton>
      </div>
    </form>
  )
}

/** The addon's own settings form, saved as the channel's config, and the chat it posts its
 * system lines to, if it posts any. */
function AddonTab({ server, channel, addon }: { server: ServerDetail; channel: Channel; addon: AddonModule }): ReactNode {
  const { Settings, announces } = addon
  const textChannels = server.channels.filter((c) => c.type === 'text')
  // A deleted announce channel means the lines are off.
  const savedAnnounce = textChannels.some((c) => c.id === channel.announce_channel_id) ? channel.announce_channel_id! : ''
  const [config, setConfig] = useState(channel.config)
  const [announce, setAnnounce] = useState(savedAnnounce)
  // Set when the API asks to confirm a chat seen by more people than the addon channel.
  const [wider, setWider] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const configDirty = JSON.stringify(config) !== JSON.stringify(channel.config)
  const dirty = configDirty || announce !== savedAnnounce

  async function save(confirmed = false): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {}
      if (configDirty) body.config = config
      if (announce !== savedAnnounce) {
        body.announce_channel_id = announce || null
        body.confirm_wider_audience = confirmed
      }
      await api(`/channels/${channel.id}`, { method: 'PATCH', body })
      setWider(null)
    } catch (err) {
      const detail = err instanceof ApiError && err.status === 409 ? (err.detail as { code?: string; count?: number }) : null
      if (detail?.code === 'wider_audience') setWider(detail.count ?? 0)
      else setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-[520px] space-y-3">
      <FormError message={error} />
      {Settings && <Settings config={config} onChange={setConfig} />}
      {announces && (
        <label className="block">
          <span className={labelClass}>{announces.label}</span>
          <select
            value={announce}
            onChange={(e) => {
              setAnnounce(e.target.value)
              setWider(null)
            }}
            className={inputClass}
          >
            <option value="">{t('server.channel.off')}</option>
            {textChannels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-xs text-fg-subtle">{announces.hint}</span>
        </label>
      )}
      {wider !== null && announces ? (
        <div role="alert" className="space-y-3 rounded-control border border-idle/50 bg-idle/10 px-3 py-2.5 text-sm">
          <p>
            {announces.warning}{' '}
            {wider > 0 && (
              <span className="text-fg-muted">
                {t('server.channel.wider', { count: wider })}
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <div className="w-44">
              <PrimaryButton type="button" disabled={busy} onClick={() => void save(true)}>
                {t('server.channel.useAnyway')}
              </PrimaryButton>
            </div>
            <div className="w-32">
              <SecondaryButton type="button" disabled={busy} onClick={() => setWider(null)}>
                {t('common.cancel')}
              </SecondaryButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-32">
          <PrimaryButton type="button" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? t('common.saving') : t('common.save')}
          </PrimaryButton>
        </div>
      )}
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

/** Whether the channel follows its category, and the way back when it doesn't. */
function SyncNotice({ server, channel }: { server: ServerDetail; channel: Channel }): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const category = server.categories?.find((c) => c.id === channel.category_id)
  if (!category) return null
  const sync = (): void => {
    setError(null)
    api(`/channels/${channel.id}/permissions/sync`, { method: 'POST' })
      .then(() => useChat.getState().refreshServer(server.id))
      .catch((err) => setError(errorText(err)))
  }
  return (
    <div className="flex items-center gap-3 rounded-control border border-line bg-main px-3 py-2 text-sm text-fg-muted">
      <span className="min-w-0 flex-1">
        {channel.permissions_synced ? t('server.channel.synced', { category: category.name }) : t('server.channel.ownPerms', { category: category.name })}
      </span>
      {!channel.permissions_synced && (
        <button type="button" onClick={sync} className="shrink-0 rounded-control border border-line px-3 py-1.5 font-medium hover:bg-elevated hover:text-fg">
          {t('server.channel.sync')}
        </button>
      )}
      <FormError message={error} />
    </div>
  )
}

/** Permitir/Herdar/Negar per role and member; `path` is where the overrides are saved. */
export function PermissionsEditor({
  server,
  channel,
  meId,
  path,
  place
}: {
  server: ServerDetail
  channel: Channel
  meId: string
  path: string
  /** "neste canal", "nesta categoria". */
  place: string
}): ReactNode {
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
        path={path}
        place={place}
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
        <Plus size={16} /> {t('server.channel.addTarget')}
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
  path: base,
  place,
  target,
  override,
  onRemoved
}: {
  server: ServerDetail
  channel: Channel
  meId: string
  path: string
  place: string
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
  const sections = permSections(channel)

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
  const path = `${base}/${target.type}/${target.id}`

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm text-fg-muted">
        {target.id === server.id
          ? t('server.channel.everyone', { place })
          : t(target.type === 'role' ? 'server.channel.forRole' : 'server.channel.forMember', { place })}
      </p>
      {!editable && (
        <p className="rounded-control border border-line bg-main px-3 py-2 text-sm text-fg-muted">{t('server.channel.readOnly')}</p>
      )}
      <FormError message={error} />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
        {STATES.map(({ value, label, icon: Icon }) => (
          <span key={value} className="flex items-center gap-1">
            <Icon size={12} /> {value === 'inherit' ? t('server.channel.inheritHint') : label}
          </span>
        ))}
      </p>
      {sections.map(({ title, names }) => (
        <section key={title}>
          <h3 className={labelClass}>{title}</h3>
          <div className="space-y-1.5">
            {names.map((name) => {
              const bit = Perm[name]
              const info = (channel.type === 'addon' && ADDON_LABELS[name]) || PERM_INFO[name]
              // Nobody grants (or denies) a permission they don't have here.
              const allowed = editable && has(myPerms, bit)
              return (
                <div key={name} className={`flex items-center justify-between gap-4 rounded-control border border-line bg-main px-3 py-2 ${allowed ? '' : 'opacity-60'}`}>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{name === 'MANAGE_ROLES' ? t('permissions.managePermissions') : info.label}</span>
                    {info.description && <span className="block text-xs text-fg-subtle">{info.description}</span>}
                  </span>
                  <TriState value={stateOf(bit)} disabled={!allowed} onChange={(s) => set(bit, s)} label={info.label} />
                </div>
              )
            })}
          </div>
        </section>
      ))}
      {editable && (
        <div className="sticky bottom-0 flex items-center gap-3 bg-panel py-3">
          <div className="w-36">
            <PrimaryButton type="button" disabled={!dirty || busy} onClick={() => void send(() => api(path, { method: 'PUT', body: { allow, deny } }))}>
              {busy ? t('common.saving') : t('common.save')}
            </PrimaryButton>
          </div>
          {override && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(() => api(path, { method: 'DELETE' }), onRemoved)}
              className="ml-auto text-sm font-medium text-danger hover:underline"
            >
              {t('server.channel.removeOverrides')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const state = (value: State, icon: typeof Check, tone: string): { value: State; readonly label: string; icon: typeof Check; tone: string } => ({
  value,
  get label() {
    return t(`server.channel.states.${value}`)
  },
  icon,
  tone
})
const STATES = [state('deny', X, 'bg-danger text-on-danger'), state('inherit', Minus, 'bg-elevated text-fg'), state('allow', Check, 'bg-success/25 text-success')]

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

