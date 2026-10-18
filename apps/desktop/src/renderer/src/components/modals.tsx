import { Check, Hash, Volume2 } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { addonModule } from '../addons/registry'
import { api, ApiError, type AddonInfo, type Channel, type Invite, type ServerDetail } from '../lib/api'
import { memberName } from '../lib/members'
import { basePermissions, has, outranks, Perm, rankOf } from '../lib/permissions'
import { useChat } from '../store/chat'
import { channelTab, useNav } from '../store/nav'
import { DangerButton, FormError, Modal, SecondaryButton } from './Modal'
import { Avatar, Field, labelClass, PrimaryButton, Segmented, ToggleRow } from './ui'

export function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Convite não encontrado.'
    if (err.status === 410) return 'Esse convite expirou ou atingiu o limite de usos.'
    if (err.status === 403) return 'Você não tem permissão para isso.'
  }
  return err instanceof TypeError ? 'Não foi possível conectar ao servidor.' : fallback
}

/** Accepts a bare code or anything ending in it (e.g. a pasted link). */
function parseInviteCode(input: string): string {
  return input.trim().split('/').filter(Boolean).pop() ?? ''
}

export function AddServerModal({ onClose }: { onClose(): void }): ReactNode {
  const addServer = useChat((s) => s.addServer)
  const [tab, setTab] = useState<'create' | 'join'>('create')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const input = tab === 'create' ? value.trim() : parseInviteCode(value)
    if (!input) return setError(tab === 'create' ? 'Dê um nome ao servidor.' : 'Cole o código do convite.')
    setBusy(true)
    setError(null)
    try {
      const server =
        tab === 'create'
          ? await api<ServerDetail>('/servers', { method: 'POST', body: { name: input } })
          : await api<ServerDetail>(`/invites/${encodeURIComponent(input)}/join`, { method: 'POST' })
      addServer(server)
      useNav.getState().openServer(server.id)
      onClose()
    } catch (err) {
      setError(errorText(err, 'Algo deu errado. Tente de novo.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={tab === 'create' ? 'Criar um servidor' : 'Entrar em um servidor'}
      subtitle={tab === 'create' ? 'Um lugar pra você e seus amigos.' : 'Cole o código de convite que te mandaram.'}
      onClose={onClose}
    >
      <div className="mb-4">
        <Segmented
          options={[
            { value: 'create', label: 'Criar' },
            { value: 'join', label: 'Tenho um convite' }
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t)
            setValue('')
            setError(null)
          }}
        />
      </div>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        <Field
          key={tab}
          autoFocus
          label={tab === 'create' ? 'Nome do servidor' : 'Código do convite'}
          value={value}
          maxLength={tab === 'create' ? 100 : 200}
          placeholder={tab === 'create' ? 'Ex.: Os Brabos' : 'Ex.: aB3dE9fG'}
          onChange={(e) => setValue(e.target.value)}
        />
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Aguarde…' : tab === 'create' ? 'Criar' : 'Entrar no servidor'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

export function InviteModal({ server, onClose }: { server: ServerDetail; onClose(): void }): ReactNode {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api<Invite>(`/servers/${server.id}/invites`, { method: 'POST', body: {} })
      .then(setInvite)
      .catch((err) => setError(errorText(err, 'Não foi possível criar o convite.')))
  }, [server.id])

  async function copy(): Promise<void> {
    if (!invite) return
    await navigator.clipboard.writeText(invite.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal title={`Convidar para ${server.name}`} onClose={onClose}>
      <FormError message={error} />
      <span className={labelClass}>Código do convite</span>
      <div className="flex items-center gap-2 rounded-control border border-line bg-main p-1.5 pl-3">
        <code className="flex-1 select-text font-mono text-lg tracking-wider">{invite?.code ?? '…'}</code>
        <button
          type="button"
          onClick={copy}
          disabled={!invite}
          className="flex items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          {copied && <Check size={16} />}
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
      <p className="mt-2 text-xs text-fg-subtle">
        Expira em 7 dias. Quem ainda não tem conta usa o código no <b>cadastro</b>; quem já tem cola em{' '}
        <b>+ → Tenho um convite</b>.
      </p>
    </Modal>
  )
}

/** Who may see a channel being created: everyone, or (private) only the picked roles and members. */
type Access = { private: boolean; roles: string[]; members: string[] }
const PUBLIC: Access = { private: false, roles: [], members: [] }

function accessBody(access: Access): Record<string, unknown> {
  return access.private ? { private: true, allowed_roles: access.roles, allowed_members: access.members } : {}
}

/** "Canal privado" and, when on, the roles and members who get in. Shown only to who can edit
 * permissions; lists only roles and members ranked below the user (the API's rule). */
function PrivateAccess({
  serverId,
  voice,
  value,
  onChange
}: {
  serverId: string
  voice: boolean
  value: Access
  onChange(access: Access): void
}): ReactNode {
  const server = useChat((s) => s.servers[serverId])
  const meId = useChat((s) => s.meId)
  if (!server || !meId || !has(basePermissions(server, meId), Perm.MANAGE_ROLES)) return null

  const roles = server.roles.filter((r) => r.id !== server.id && outranks(server, meId, r.position))
  const members = server.members.filter((m) => m.user.id !== meId && outranks(server, meId, rankOf(server, m.user.id)))
  const toggle = (list: 'roles' | 'members', id: string): void =>
    onChange({ ...value, [list]: value[list].includes(id) ? value[list].filter((x) => x !== id) : [...value[list], id] })
  const row = 'flex cursor-pointer items-center gap-2 rounded-item px-2 py-1.5 text-sm hover:bg-elevated'

  return (
    <div className="space-y-2">
      <ToggleRow
        title="Canal privado"
        description={`Só os cargos e membros escolhidos ${voice ? 'veem e entram na sala' : 'veem o canal'}.`}
        checked={value.private}
        onChange={(on) => onChange({ ...value, private: on })}
      />
      {value.private && (
        <div className="rounded-control border border-line bg-main p-1.5">
          <div className="max-h-48 overflow-y-auto">
            {roles.length > 0 && <p className={`${labelClass} px-2 pt-1`}>Cargos</p>}
            {roles.map((r) => (
              <label key={r.id} className={row}>
                <input type="checkbox" checked={value.roles.includes(r.id)} onChange={() => toggle('roles', r.id)} className="accent-accent" />
                <span
                  style={{ background: r.color ?? undefined }}
                  className={`inline-block h-3 w-3 shrink-0 rounded-full ${r.color ? '' : 'bg-fg-subtle'}`}
                />
                <span className="truncate">{r.name}</span>
              </label>
            ))}
            {members.length > 0 && <p className={`${labelClass} px-2 pt-2`}>Membros</p>}
            {members.map((m) => (
              <label key={m.user.id} className={row}>
                <input type="checkbox" checked={value.members.includes(m.user.id)} onChange={() => toggle('members', m.user.id)} className="accent-accent" />
                <Avatar name={memberName(m)} url={m.user.avatar_url} size={18} />
                <span className="truncate">{memberName(m)}</span>
              </label>
            ))}
          </div>
          <p className="px-2 pb-1 pt-2 text-xs text-fg-subtle">Você continua com acesso. Dá pra ajustar depois em Configurações do canal → Permissões.</p>
        </div>
      )}
    </div>
  )
}

export function CreateChannelModal({
  serverId,
  initialType,
  onClose
}: {
  serverId: string
  initialType: 'text' | 'voice'
  onClose(): void
}): ReactNode {
  const openTab = useNav((s) => s.openTab)
  const [type, setType] = useState(initialType)
  const [name, setName] = useState('')
  const [access, setAccess] = useState<Access>(PUBLIC)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim()) return setError('Dê um nome ao canal.')
    setBusy(true)
    try {
      const channel = await api<Channel>(`/servers/${serverId}/channels`, { method: 'POST', body: { name, type, ...accessBody(access) } })
      if (type === 'text') openTab(serverId, channelTab(channel.id))
      onClose()
    } catch (err) {
      setError(errorText(err, 'Não foi possível criar o canal.'))
      setBusy(false)
    }
  }

  return (
    <Modal title="Criar canal" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        <div className="space-y-2">
          {(['text', 'voice'] as const).map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer items-center gap-3 rounded-control border px-3 py-2.5 ${type === t ? 'border-accent bg-accent/10' : 'border-line bg-main hover:bg-elevated'}`}
            >
              <input type="radio" name="type" checked={type === t} onChange={() => setType(t)} className="accent-accent" />
              {t === 'text' ? <Hash size={18} className="shrink-0 text-fg-muted" /> : <Volume2 size={18} className="shrink-0 text-fg-muted" />}
              <span>
                <span className="block font-medium">{t === 'text' ? 'Texto' : 'Voz'}</span>
                <span className="block text-xs text-fg-subtle">
                  {t === 'text' ? 'Mensagens, memes e links' : 'Voz, câmera e compartilhamento de tela'}
                </span>
              </span>
            </label>
          ))}
        </div>
        <Field autoFocus label="Nome do canal" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={type === 'text' ? 'novo-canal' : 'Sala de jogo'} />
        <PrivateAccess serverId={serverId} voice={type === 'voice'} value={access} onChange={setAccess} />
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Criando…' : 'Criar canal'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

/** Adds an addon to the server: picks one of the addons both the API and this app know, and
 * creates its channel. */
export function CreateAddonModal({ serverId, onClose }: { serverId: string; onClose(): void }): ReactNode {
  const openTab = useNav((s) => s.openTab)
  const [addons, setAddons] = useState<AddonInfo[] | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [access, setAccess] = useState<Access>(PUBLIC)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<AddonInfo[]>('/addons')
      .then((list) => {
        const usable = list.filter((a) => addonModule(a.key))
        setAddons(usable)
        if (usable[0]) {
          setKey(usable[0].key)
          setName(usable[0].name)
        }
      })
      .catch((err) => setError(errorText(err, 'Não foi possível carregar os addons.')))
  }, [])

  const pick = (addon: AddonInfo): void => {
    // Keep a name the user typed; follow the addon's name otherwise.
    if (!name.trim() || name === addons?.find((a) => a.key === key)?.name) setName(addon.name)
    setKey(addon.key)
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!key) return
    if (!name.trim()) return setError('Dê um nome ao addon.')
    setBusy(true)
    try {
      const channel = await api<Channel>(`/servers/${serverId}/channels`, {
        method: 'POST',
        body: { name: name.trim(), type: 'addon', addon_key: key, ...accessBody(access) }
      })
      openTab(serverId, channelTab(channel.id))
      onClose()
    } catch (err) {
      setError(errorText(err, 'Não foi possível adicionar o addon.'))
      setBusy(false)
    }
  }

  return (
    <Modal title="Adicionar addon" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <FormError message={error} />
        {addons === null && !error && <p className="text-sm text-fg-muted">Carregando…</p>}
        {addons?.length === 0 && <p className="text-sm text-fg-muted">Nenhum addon disponível nesta versão.</p>}
        <div className="space-y-2">
          {addons?.map((addon) => {
            const Icon = addonModule(addon.key)!.icon
            return (
              <label
                key={addon.key}
                className={`flex cursor-pointer items-center gap-3 rounded-control border px-3 py-2.5 ${key === addon.key ? 'border-accent bg-accent/10' : 'border-line bg-main hover:bg-elevated'}`}
              >
                <input type="radio" name="addon" checked={key === addon.key} onChange={() => pick(addon)} className="accent-accent" />
                <Icon size={18} className="shrink-0 text-fg-muted" />
                <span>
                  <span className="block font-medium">{addon.name}</span>
                  <span className="block text-xs text-fg-subtle">{addon.description}</span>
                </span>
              </label>
            )
          })}
        </div>
        {key && <Field label="Nome" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />}
        {key && <PrivateAccess serverId={serverId} voice={false} value={access} onChange={setAccess} />}
        <PrimaryButton type="submit" disabled={busy || !key}>
          {busy ? 'Adicionando…' : 'Adicionar'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
  children
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm(): Promise<void>
  onClose(): void
  /** Extra fields under the message (e.g. a ban reason). */
  children?: ReactNode
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm(): Promise<void> {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(errorText(err, 'Algo deu errado. Tente de novo.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-center text-fg-muted">{message}</p>
      {children}
      <div className="mt-5 space-y-3">
        <FormError message={error} />
        <div className="grid grid-cols-2 gap-3">
          <SecondaryButton type="button" onClick={onClose}>
            Cancelar
          </SecondaryButton>
          <DangerButton type="button" onClick={confirm} disabled={busy}>
            {confirmLabel}
          </DangerButton>
        </div>
      </div>
    </Modal>
  )
}
