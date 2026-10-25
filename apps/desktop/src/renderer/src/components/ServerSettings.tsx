import { Crown, GripVertical, Pipette, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { api, ApiError, type Ban, type Member, type Role, type ServerDetail } from '../lib/api'
import { basePermissions, has, outranks, Perm, PERMISSION_GROUPS, rankOf } from '../lib/permissions'
import { ACCENT_PRESETS, useReadableColor } from '../store/appearance'
import { useChat } from '../store/chat'
import { CroppedImageRow, imageForm, ImageRow, uploadError } from './ImageCropper'
import { ConfirmModal } from './modals'
import { FormError, Modal, ModalBody, ModalTabs } from './Modal'
import { ServerBannerLayer } from './ServerBanner'
import { Avatar, cn, Field, inputClass, labelClass, menuClass, PrimaryButton, ServerIcon, ToggleRow, useDismiss } from './ui'

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 403) return 'Você não tem permissão para isso.'
  if (err instanceof ApiError && (err.status === 413 || err.status === 415)) return uploadError(err)
  return fallback
}

/** Runs a change, then refetches the server (the event does too, but this is immediate). */
function useAction(serverId: string): {
  busy: string | null
  error: string | null
  setError(message: string | null): void
  run(label: string, action: () => Promise<unknown>, fallback?: string): Promise<boolean>
} {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(
    async (label: string, action: () => Promise<unknown>, fallback = 'Algo deu errado. Tente de novo.') => {
      setBusy(label)
      setError(null)
      try {
        await action()
        await useChat.getState().refreshServer(serverId)
        return true
      } catch (err) {
        setError(errorText(err, fallback))
        return false
      } finally {
        setBusy(null)
      }
    },
    [serverId]
  )
  return { busy, error, setError, run }
}

type Tab = 'general' | 'roles' | 'members' | 'bans'

export function ServerSettingsModal({ server, meId, onClose }: { server: ServerDetail; meId: string; onClose(): void }): ReactNode {
  const perms = basePermissions(server, meId)
  const tabs = (
    [
      ['general', 'Visão geral', has(perms, Perm.MANAGE_SERVER)],
      ['roles', 'Cargos', has(perms, Perm.MANAGE_ROLES)],
      ['members', 'Membros', has(perms, Perm.MANAGE_ROLES | Perm.KICK_MEMBERS | Perm.BAN_MEMBERS)],
      ['bans', 'Banimentos', has(perms, Perm.BAN_MEMBERS)]
    ] as const
  ).filter(([, , allowed]) => allowed)
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'general')

  return (
    <Modal title={`Configurações de ${server.name}`} wide tall onClose={onClose}>
      <ModalTabs<Tab> tabs={tabs} isCurrent={(key) => tab === key} onSelect={setTab} />
      <ModalBody>
        {tab === 'general' && <GeneralTab server={server} />}
        {tab === 'roles' && <RolesTab server={server} meId={meId} />}
        {tab === 'members' && <MembersTab server={server} meId={meId} />}
        {tab === 'bans' && <BansTab server={server} />}
      </ModalBody>
    </Modal>
  )
}

// --- Overview: name, icon, banner -----------------------------------------------

function GeneralTab({ server }: { server: ServerDetail }): ReactNode {
  const [name, setName] = useState(server.name)
  const { busy, error, run } = useAction(server.id)

  // The answer comes as server.updated too; refetching shows it right away.
  const refresh = (): void => void useChat.getState().refreshServer(server.id)

  return (
    <div className="max-w-[520px] space-y-5">
      <FormError message={error} />
      <div className="relative flex h-28 items-end gap-3 overflow-hidden rounded-panel p-3">
        <ServerBannerLayer server={server} />
        <span className="relative rounded-control border-4 border-panel">
          <ServerIcon name={server.name} url={server.icon_url} size={48} />
        </span>
      </div>
      <CroppedImageRow label="Ícone" shape="icon" path={`/servers/${server.id}/icon`} hasImage={!!server.icon_url} crop={server.icon_crop}
        name={server.name} onDone={refresh} />
      <CroppedImageRow label="Banner" shape="server-banner" path={`/servers/${server.id}/banner`} hasImage={!!server.banner_url}
        crop={server.banner_crop} name={server.name} onDone={refresh} />
      <p className="-mt-2 text-xs text-fg-subtle">PNG, JPG, GIF ou WebP de até 8 MB. GIFs e WebPs animados continuam animados.</p>
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void run('name', () => api(`/servers/${server.id}`, { method: 'PATCH', body: { name: name.trim() } }))
        }}
      >
        <div className="flex-1">
          <Field label="Nome do servidor" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-32">
          <PrimaryButton type="submit" disabled={busy !== null || !name.trim() || name.trim() === server.name}>
            Salvar
          </PrimaryButton>
        </div>
      </form>
    </div>
  )
}

// --- Roles -----------------------------------------------------------------------

function RoleDot({ role, size = 12 }: { role: Role; size?: number }): ReactNode {
  return (
    <span
      style={{ width: size, height: size, background: role.color ?? undefined }}
      className={`inline-block shrink-0 rounded-full ${role.color ? '' : 'bg-fg-subtle'}`}
    />
  )
}

function RolesTab({ server, meId }: { server: ServerDetail; meId: string }): ReactNode {
  const [selected, setSelected] = useState<string>(server.roles[0]?.id ?? server.id)
  const [dragging, setDragging] = useState<string | null>(null)
  const { busy, error, run } = useAction(server.id)
  const role = server.roles.find((r) => r.id === selected) ?? server.roles[server.roles.length - 1]
  const ordered = server.roles.filter((r) => r.id !== server.id) // strongest first
  const canMove = (r: Role): boolean => outranks(server, meId, r.position)

  const create = (): Promise<boolean> =>
    run('create', async () => {
      const created = await api<Role>(`/servers/${server.id}/roles`, { method: 'POST', body: { name: 'novo cargo' } })
      setSelected(created.id)
    })

  function drop(targetId: string): void {
    if (!dragging || dragging === targetId) return
    const ids = ordered.map((r) => r.id).filter((id) => id !== dragging)
    ids.splice(ids.indexOf(targetId), 0, dragging)
    setDragging(null)
    void run('order', () => api(`/servers/${server.id}/roles/order`, { method: 'PUT', body: { role_ids: ids } }))
  }

  return (
    <div className="grid grid-cols-[200px_1fr] gap-5">
      <div className="space-y-1">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void create()}
          className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-control border border-dashed border-line py-2 text-sm font-medium text-fg-muted hover:border-accent hover:text-fg"
        >
          <Plus size={16} /> Criar cargo
        </button>
        {ordered.map((r) => (
          <button
            key={r.id}
            type="button"
            draggable={canMove(r)}
            onDragStart={() => setDragging(r.id)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => dragging && canMove(r) && e.preventDefault()}
            onDrop={() => drop(r.id)}
            onClick={() => setSelected(r.id)}
            className={`flex w-full items-center gap-2 rounded-item px-2 py-1.5 text-left text-sm ${
              r.id === role.id ? 'bg-elevated text-fg' : 'text-fg-muted hover:bg-elevated/60 hover:text-fg'
            } ${dragging === r.id ? 'opacity-50' : ''}`}
          >
            <GripVertical size={14} className={canMove(r) ? 'cursor-grab text-fg-subtle' : 'invisible'} />
            <RoleDot role={r} />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSelected(server.id)}
          className={`flex w-full items-center gap-2 rounded-item px-2 py-1.5 text-left text-sm ${
            role.id === server.id ? 'bg-elevated text-fg' : 'text-fg-muted hover:bg-elevated/60 hover:text-fg'
          }`}
        >
          <span className="w-[14px]" />
          <span className="min-w-0 flex-1 truncate">@everyone</span>
        </button>
        <p className="px-2 pt-2 text-xs text-fg-subtle">Arraste para mudar a hierarquia. Cargos de cima mandam nos de baixo.</p>
        <FormError message={error} />
      </div>
      <RoleEditor key={role.id} server={server} role={role} meId={meId} onDeleted={() => setSelected(server.id)} />
    </div>
  )
}

function RoleEditor({ server, role, meId, onDeleted }: { server: ServerDetail; role: Role; meId: string; onDeleted(): void }): ReactNode {
  const everyone = role.id === server.id
  const myPerms = basePermissions(server, meId)
  const editable = everyone ? has(myPerms, Perm.MANAGE_ROLES) : outranks(server, meId, role.position)
  const [form, setForm] = useState({ name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions })
  const [confirming, setConfirming] = useState(false)
  const { busy, error, setError, run } = useAction(server.id)
  const dirty =
    form.name.trim() !== role.name ||
    form.color !== role.color ||
    form.hoist !== role.hoist ||
    form.mentionable !== role.mentionable ||
    form.permissions !== role.permissions

  const save = (): void => {
    const body = everyone
      ? { permissions: form.permissions }
      : { name: form.name.trim(), color: form.color, hoist: form.hoist, mentionable: form.mentionable, permissions: form.permissions }
    void run('save', () => api(`/roles/${role.id}`, { method: 'PATCH', body }), 'Não foi possível salvar o cargo.')
  }
  const toggle = (bit: number, on: boolean): void =>
    setForm((f) => ({ ...f, permissions: on ? f.permissions | bit : f.permissions & ~bit }))

  return (
    <div className="min-w-0 space-y-4">
      {!editable && (
        <p className="rounded-control border border-line bg-main px-3 py-2 text-sm text-fg-muted">
          Esse cargo está no seu nível ou acima: só dá pra ver.
        </p>
      )}
      <FormError message={error} />
      {!everyone && (
        <>
          <Field label="Nome do cargo" maxLength={100} disabled={!editable} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div>
            <span className={labelClass}>Cor</span>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENT_PRESETS.map(({ name, hex }) => (
                <button
                  key={hex}
                  type="button"
                  title={name}
                  aria-label={name}
                  disabled={!editable}
                  onClick={() => setForm({ ...form, color: hex })}
                  className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-panel ${form.color?.toUpperCase() === hex ? 'ring-2 ring-fg' : ''}`}
                  style={{ background: hex }}
                />
              ))}
              <label title="Outra cor" className="relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-line text-fg-muted hover:text-fg">
                <Pipette size={14} />
                <input type="color" disabled={!editable} value={form.color ?? ACCENT_PRESETS[0].hex} onChange={(e) => setForm({ ...form, color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
              {form.color && editable && (
                <button type="button" onClick={() => setForm({ ...form, color: null })} className="text-xs text-fg-subtle hover:text-fg">
                  Sem cor
                </button>
              )}
            </div>
          </div>
          {editable && (
          <ImageRow
            label="Ícone do cargo"
            busy={busy === 'icon'}
            hasImage={!!role.icon_url}
            onPick={(e) => {
              const body = imageForm(e, setError)
              if (body) void run('icon', () => api(`/roles/${role.id}/icon`, { method: 'POST', body }), 'Não foi possível enviar a imagem.')
            }}
            onRemove={() => void run('icon', () => api(`/roles/${role.id}/icon`, { method: 'DELETE' }))}
          />
          )}
          <ToggleRow
            title="Exibir separadamente"
            description="Quem tem o cargo aparece num grupo próprio na lista de membros."
            checked={form.hoist}
            onChange={(hoist) => editable && setForm({ ...form, hoist })}
          />
          <ToggleRow
            title="Mencionável"
            description="Reservado: menções a cargos chegam numa próxima versão."
            checked={form.mentionable}
            onChange={(mentionable) => editable && setForm({ ...form, mentionable })}
          />
        </>
      )}

      {everyone && <p className="text-sm text-fg-muted">O que todo mundo do servidor pode fazer, antes dos outros cargos.</p>}
      {PERMISSION_GROUPS.map((group) => (
        <section key={group.title}>
          <h3 className={labelClass}>{group.title}</h3>
          <div className="space-y-1.5">
            {group.items.map(({ perm, label, description }) => {
              const bit = Perm[perm]
              // Nobody grants (or takes away) a permission they don't have.
              const allowed = editable && has(myPerms, bit)
              return (
                <label
                  key={perm}
                  className={`flex items-center justify-between gap-4 rounded-control border border-line bg-main px-3 py-2 ${allowed ? 'cursor-pointer' : 'opacity-60'}`}
                >
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    {description && <span className="block text-xs text-fg-subtle">{description}</span>}
                  </span>
                  <input
                    type="checkbox"
                    disabled={!allowed}
                    checked={has(form.permissions, bit)}
                    onChange={(e) => toggle(bit, e.target.checked)}
                    className="h-5 w-5 shrink-0 accent-accent"
                  />
                </label>
              )
            })}
          </div>
        </section>
      ))}

      {editable && (
        <div className="sticky bottom-0 flex items-center gap-3 bg-panel py-3">
          <div className="w-36">
            <PrimaryButton type="button" disabled={!dirty || busy !== null || (!everyone && !form.name.trim())} onClick={save}>
              {busy === 'save' ? 'Salvando…' : 'Salvar'}
            </PrimaryButton>
          </div>
          {dirty && (
            <button
              type="button"
              onClick={() => setForm({ name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions })}
              className="text-sm text-fg-muted hover:text-fg"
            >
              Desfazer
            </button>
          )}
          {!everyone && (
            <button type="button" onClick={() => setConfirming(true)} className="ml-auto text-sm font-medium text-danger hover:underline">
              Excluir cargo
            </button>
          )}
        </div>
      )}
      {confirming && (
        <ConfirmModal
          title={`Excluir ${role.name}`}
          message="Quem tem o cargo perde as permissões dele."
          confirmLabel="Excluir cargo"
          onConfirm={async () => {
            await api(`/roles/${role.id}`, { method: 'DELETE' })
            onDeleted()
            await useChat.getState().refreshServer(server.id)
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

// --- Members -----------------------------------------------------------------------

type MemberAction = { kind: 'kick' | 'ban'; member: Member }

function MembersTab({ server, meId }: { server: ServerDetail; meId: string }): ReactNode {
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<MemberAction | null>(null)
  const [reason, setReason] = useState('')
  const { error, run } = useAction(server.id)
  const q = query.trim().toLowerCase()
  const members = server.members
    .filter((m) => !q || m.user.display_name.toLowerCase().includes(q) || m.user.username.includes(q))
    .sort((a, b) => a.user.display_name.localeCompare(b.user.display_name))

  return (
    <div className="space-y-3">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar membro" className={inputClass} />
      <FormError message={error} />
      <div className="divide-y divide-line">
        {members.map((m) => (
          <MemberRow key={m.user.id} server={server} member={m} meId={meId} run={run} onAction={(kind) => setAction({ kind, member: m })} />
        ))}
      </div>
      {action && (
        <ConfirmModal
          title={`${action.kind === 'kick' ? 'Expulsar' : 'Banir'} ${action.member.user.display_name}`}
          message={
            action.kind === 'kick'
              ? 'A pessoa sai do servidor, mas pode voltar com um convite.'
              : 'A pessoa sai do servidor e não consegue voltar enquanto estiver banida.'
          }
          confirmLabel={action.kind === 'kick' ? 'Expulsar' : 'Banir'}
          onConfirm={async () => {
            const path = `/servers/${server.id}/${action.kind === 'kick' ? 'members' : 'bans'}/${action.member.user.id}`
            await (action.kind === 'kick'
              ? api(path, { method: 'DELETE' })
              : api(path, { method: 'PUT', body: { reason: reason.trim() || null } }))
            setReason('')
          }}
          onClose={() => setAction(null)}
        >
          {action.kind === 'ban' && (
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" className={cn(inputClass, 'mt-4')} />
          )}
        </ConfirmModal>
      )}
    </div>
  )
}

function MemberRow({
  server,
  member: m,
  meId,
  run,
  onAction
}: {
  server: ServerDetail
  member: Member
  meId: string
  run(label: string, action: () => Promise<unknown>): Promise<boolean>
  onAction(kind: 'kick' | 'ban'): void
}): ReactNode {
  const [adding, setAdding] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setAdding(false), [])
  useDismiss(ref, adding, close)
  const perms = basePermissions(server, meId)
  const canAssign = has(perms, Perm.MANAGE_ROLES)
  const isOwner = m.user.id === server.owner_id
  // Kick/ban only people ranked below you (never the owner or yourself).
  const below = m.user.id !== meId && !isOwner && outranks(server, meId, rankOf(server, m.user.id))
  const roles = server.roles.filter((r) => m.role_ids.includes(r.id))
  const assignable = server.roles.filter((r) => r.id !== server.id && !m.role_ids.includes(r.id) && outranks(server, meId, r.position))
  const path = (roleId: string): string => `/servers/${server.id}/members/${m.user.id}/roles/${roleId}`

  return (
    <div className="flex items-start gap-3 py-2.5">
      <Avatar name={m.user.display_name} url={m.user.avatar_url} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{m.user.display_name}</span>
          <span className="truncate text-xs text-fg-subtle">@{m.user.username}</span>
          {isOwner && <Crown size={14} aria-label="Dono do servidor" className="shrink-0 text-accent-text" />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {roles.map((r) => (
            <span key={r.id} className="flex items-center gap-1 rounded-full border border-line bg-main py-0.5 pl-1.5 pr-1 text-xs">
              <RoleDot role={r} size={8} />
              {r.name}
              {canAssign && outranks(server, meId, r.position) && (
                <button type="button" aria-label={`Tirar ${r.name}`} title={`Tirar ${r.name}`} onClick={() => void run('role', () => api(path(r.id), { method: 'DELETE' }))} className="text-fg-subtle hover:text-fg">
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {canAssign && assignable.length > 0 && (
            <div ref={ref} className="relative">
              <button type="button" aria-label="Dar cargo" title="Dar cargo" onClick={() => setAdding((v) => !v)} className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-line text-fg-muted hover:border-accent hover:text-fg">
                <Plus size={12} />
              </button>
              {adding && (
                <div className={`${menuClass} absolute left-0 top-6 max-h-56 w-48 overflow-y-auto`}>
                  {assignable.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setAdding(false)
                        void run('role', () => api(path(r.id), { method: 'PUT' }))
                      }}
                      className="flex w-full items-center gap-2 rounded-item px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-elevated hover:text-fg"
                    >
                      <RoleDot role={r} size={10} />
                      <span className="truncate">{r.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {below && has(perms, Perm.KICK_MEMBERS) && (
        <button type="button" onClick={() => onAction('kick')} className="rounded-control px-2.5 py-1.5 text-sm text-fg-muted hover:bg-elevated hover:text-fg">
          Expulsar
        </button>
      )}
      {below && has(perms, Perm.BAN_MEMBERS) && (
        <button type="button" onClick={() => onAction('ban')} className="rounded-control px-2.5 py-1.5 text-sm text-danger hover:bg-danger/10">
          Banir
        </button>
      )}
    </div>
  )
}

// --- Bans --------------------------------------------------------------------------

function BansTab({ server }: { server: ServerDetail }): ReactNode {
  const [bans, setBans] = useState<Ban[] | null>(null)
  const { error, run } = useAction(server.id)
  const load = useCallback(() => api<Ban[]>(`/servers/${server.id}/bans`).then(setBans), [server.id])
  useEffect(() => void load().catch(() => setBans([])), [load])

  if (bans === null) return <p className="text-sm text-fg-muted">Carregando…</p>
  return (
    <div className="space-y-3">
      <FormError message={error} />
      {bans.length === 0 && <p className="text-sm text-fg-muted">Ninguém banido.</p>}
      <div className="divide-y divide-line">
        {bans.map((ban) => (
          <BanRow key={ban.user.id} ban={ban} onUnban={() => void run('unban', () => api(`/servers/${server.id}/bans/${ban.user.id}`, { method: 'DELETE' }).then(load))} />
        ))}
      </div>
    </div>
  )
}

function BanRow({ ban, onUnban }: { ban: Ban; onUnban(): void }): ReactNode {
  const nameColor = useReadableColor(ban.user.accent_color)
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Avatar name={ban.user.display_name} url={ban.user.avatar_url} size={32} />
      <div className="min-w-0 flex-1">
        <span className="block truncate font-medium" style={nameColor ? { color: nameColor } : undefined}>
          {ban.user.display_name}
        </span>
        <span className="block truncate text-xs text-fg-subtle">{ban.reason || 'Sem motivo informado'}</span>
      </div>
      <button type="button" onClick={onUnban} className="rounded-control px-2.5 py-1.5 text-sm text-fg-muted hover:bg-elevated hover:text-fg">
        Revogar
      </button>
    </div>
  )
}
