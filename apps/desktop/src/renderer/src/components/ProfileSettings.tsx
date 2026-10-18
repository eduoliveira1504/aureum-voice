import { Pipette, Plus, Trash2 } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { api, ApiError, type AvatarFrame, type CustomStatus, type Me } from '../lib/api'
import { ACCENT_PRESETS } from '../store/appearance'
import { CustomStatusEditor, draftOf, statusFromDraft, type StatusDraft } from './CustomStatus'
import { FormError } from './Modal'
import { errorText } from './modals'
import { ProfileView } from './ProfileCard'
import { FRAME_PRESETS } from './profileBits'
import { Field, inputClass, labelClass, PrimaryButton } from './ui'

const MAX_BYTES = 8 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
const MAX_LINKS = 5

const FRAME_OPTIONS: { key: AvatarFrame; name: string; color: string | null }[] = [
  { key: 'none', name: 'Nenhuma', color: null },
  { key: 'accent', name: 'Cor do perfil', color: null },
  ...FRAME_PRESETS.map((p) => ({ key: p.key, name: p.name, color: p.hex }))
]

export function uploadError(err: unknown): string {
  if (err instanceof ApiError && err.status === 413) return 'A imagem passa de 8 MB.'
  if (err instanceof ApiError && err.status === 415) return 'Formato não suportado. Use PNG, JPG, GIF ou WebP.'
  return 'Não foi possível enviar a imagem.'
}

interface LinkDraft {
  label: string
  url: string
}

interface Form {
  display_name: string
  bio: string
  accent_color: string | null
  pronouns: string
  avatar_frame: AvatarFrame
  song: { title: string; artist: string; url: string }
  links: LinkDraft[]
  status: StatusDraft
}

function formOf(user: Me): Form {
  const song = user.favorite_song
  return {
    display_name: user.display_name,
    bio: user.bio ?? '',
    accent_color: user.accent_color,
    pronouns: user.pronouns ?? '',
    avatar_frame: user.avatar_frame,
    song: { title: song?.title ?? '', artist: song?.artist ?? '', url: song?.url ?? '' },
    links: user.links.map((l) => ({ ...l })),
    status: draftOf(user.custom_status)
  }
}

function isHttps(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !!parsed.hostname
  } catch {
    return false
  }
}

/** What's wrong with the form, or null. The API checks the same rules. */
function problem(form: Form): string | null {
  if (!form.display_name.trim()) return 'O nome de exibição não pode ficar vazio.'
  const [title, artist, url] = [form.song.title.trim(), form.song.artist.trim(), form.song.url.trim()]
  if ((title || artist || url) && !(title && artist)) return 'A música precisa de título e artista.'
  if (url && !isHttps(url)) return 'O link da música precisa começar com https://'
  for (const link of form.links) {
    if (!link.label.trim() || !link.url.trim()) return 'Cada link precisa de nome e endereço.'
    if (!isHttps(link.url.trim())) return `O link "${link.label.trim()}" precisa começar com https://`
  }
  return null
}

/** The PATCH body for the form; `previous` keeps the status expiry with "Manter". */
function bodyOf(form: Form, previous: CustomStatus | null): Partial<Me> {
  const [title, artist, url] = [form.song.title.trim(), form.song.artist.trim(), form.song.url.trim()]
  return {
    display_name: form.display_name.trim(),
    bio: form.bio.trim() || null,
    accent_color: form.accent_color,
    pronouns: form.pronouns.trim() || null,
    avatar_frame: form.avatar_frame,
    favorite_song: title && artist ? { title, artist, url: url || null } : null,
    links: form.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
    custom_status: statusFromDraft(form.status, previous)
  }
}

export function ProfileSettings({ user }: { user: Me }): ReactNode {
  const { setUser } = useAuth()
  const [form, setForm] = useState(() => formOf(user))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const patch = (changes: Partial<Form>): void => {
    setForm((f) => ({ ...f, ...changes }))
    setSaved(false)
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(user))
  const invalid = problem(form)
  const body = bodyOf(form, user.custom_status)
  const preview: Me = { ...user, ...body, display_name: body.display_name || user.display_name }

  async function run(label: string, action: () => Promise<Me>): Promise<void> {
    setBusy(label)
    setError(null)
    setSaved(false)
    try {
      const next = await action()
      setUser(next)
      if (label === 'save') {
        setForm(formOf(next))
        setSaved(true)
      }
    } catch (err) {
      setError(label === 'save' ? errorText(err, 'Não foi possível salvar.') : uploadError(err))
    } finally {
      setBusy(null)
    }
  }

  function pickImage(kind: 'avatar' | 'banner') {
    return (e: ChangeEvent<HTMLInputElement>): void => {
      const upload = imageForm(e, setError)
      if (upload) void run(kind, () => api<Me>(`/users/me/${kind}`, { method: 'POST', body: upload }))
    }
  }

  const save = (): Promise<void> => run('save', () => api<Me>('/users/me', { method: 'PATCH', body }))
  const setLink = (i: number, changes: Partial<LinkDraft>): void =>
    patch({ links: form.links.map((l, j) => (j === i ? { ...l, ...changes } : l)) })
  const setSong = (changes: Partial<Form['song']>): void => patch({ song: { ...form.song, ...changes } })

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div className="min-w-0 space-y-5">
        <FormError message={error} />
        <ImageRow label="Avatar" busy={busy === 'avatar'} hasImage={!!user.avatar_url} onPick={pickImage('avatar')}
          onRemove={() => run('avatar', () => api<Me>('/users/me/avatar', { method: 'DELETE' }))} />
        <ImageRow label="Banner" busy={busy === 'banner'} hasImage={!!user.banner_url} onPick={pickImage('banner')}
          onRemove={() => run('banner', () => api<Me>('/users/me/banner', { method: 'DELETE' }))} />
        <p className="-mt-2 text-xs text-fg-subtle">PNG, JPG, GIF ou WebP de até 8 MB. GIFs e WebPs animados continuam animados.</p>

        <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
          <Field label="Nome de exibição" maxLength={64} value={form.display_name} onChange={(e) => patch({ display_name: e.target.value })} />
          <Field label="Pronomes" maxLength={40} placeholder="ex: ele/dele" value={form.pronouns} onChange={(e) => patch({ pronouns: e.target.value })} />
        </div>

        <div>
          <span className={labelClass}>Status personalizado</span>
          <CustomStatusEditor draft={form.status} previous={user.custom_status} onChange={(status) => patch({ status })} />
        </div>

        <label className="block">
          <span className={`${labelClass} flex justify-between`}>
            Sobre mim <span className="font-normal normal-case">{form.bio.length}/190</span>
          </span>
          <textarea
            rows={3}
            maxLength={190}
            value={form.bio}
            onChange={(e) => patch({ bio: e.target.value })}
            placeholder="Conte um pouco sobre você"
            className={`${inputClass} resize-none`}
          />
        </label>

        <div>
          <span className={labelClass}>Cor do perfil</span>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map(({ name, hex }) => (
              <button
                key={hex}
                type="button"
                title={name}
                aria-label={name}
                onClick={() => patch({ accent_color: hex })}
                className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-panel ${form.accent_color?.toUpperCase() === hex ? 'ring-2 ring-fg' : ''}`}
                style={{ background: hex }}
              />
            ))}
            <label
              className="relative flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-line text-fg-muted hover:text-fg"
              title="Outra cor"
            >
              <Pipette size={16} />
              <input type="color" value={form.accent_color ?? ACCENT_PRESETS[0].hex} onChange={(e) => patch({ accent_color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            {form.accent_color && (
              <button type="button" onClick={() => patch({ accent_color: null })} className="text-xs text-fg-subtle hover:text-fg">
                Remover cor
              </button>
            )}
          </div>
        </div>

        <div>
          <span className={labelClass}>Moldura do avatar</span>
          <div className="flex flex-wrap gap-2">
            {FRAME_OPTIONS.map(({ key, name, color }) => (
              <button
                key={key}
                type="button"
                aria-pressed={form.avatar_frame === key}
                onClick={() => patch({ avatar_frame: key })}
                className={`flex h-9 items-center gap-2 rounded-control border px-3 text-sm ${
                  form.avatar_frame === key ? 'border-accent bg-elevated text-fg' : 'border-line text-fg-muted hover:text-fg'
                }`}
              >
                <span
                  className={`h-4 w-4 rounded-full border-2 ${key === 'none' ? 'border-dashed border-line' : ''}`}
                  style={key === 'none' ? undefined : { borderColor: color ?? form.accent_color ?? 'var(--accent)' }}
                />
                {name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={labelClass}>Música do perfil</span>
          <div className="grid grid-cols-2 gap-2">
            <input maxLength={100} aria-label="Título da música" placeholder="Título" value={form.song.title} onChange={(e) => setSong({ title: e.target.value })} className={inputClass} />
            <input maxLength={100} aria-label="Artista" placeholder="Artista" value={form.song.artist} onChange={(e) => setSong({ artist: e.target.value })} className={inputClass} />
            <input maxLength={512} aria-label="Link da música" placeholder="Link (opcional, https://…)" value={form.song.url} onChange={(e) => setSong({ url: e.target.value })} className={`${inputClass} col-span-2`} />
          </div>
        </div>

        <div>
          <span className={`${labelClass} flex justify-between`}>
            Links <span className="font-normal normal-case">{form.links.length}/{MAX_LINKS}</span>
          </span>
          <div className="space-y-2">
            {form.links.map((link, i) => (
              <div key={i} className="flex gap-2">
                <input maxLength={32} aria-label="Nome do link" placeholder="Nome" value={link.label} onChange={(e) => setLink(i, { label: e.target.value })} className={`${inputClass} shrink-0 grow-0 basis-36`} />
                <input maxLength={512} aria-label="Endereço do link" placeholder="https://…" value={link.url} onChange={(e) => setLink(i, { url: e.target.value })} className={`${inputClass} min-w-0 flex-1`} />
                <button
                  type="button"
                  title="Remover link"
                  aria-label="Remover link"
                  onClick={() => patch({ links: form.links.filter((_, j) => j !== i) })}
                  className="shrink-0 rounded-control px-2 text-fg-muted hover:bg-elevated hover:text-danger"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {form.links.length < MAX_LINKS && (
              <button
                type="button"
                onClick={() => patch({ links: [...form.links, { label: '', url: 'https://' }] })}
                className="flex items-center gap-1.5 rounded-control px-2 py-1.5 text-sm font-medium text-accent-text hover:bg-elevated"
              >
                <Plus size={16} /> Adicionar link
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-40 shrink-0">
            <PrimaryButton type="button" disabled={!dirty || !!invalid || busy !== null} onClick={save}>
              {busy === 'save' ? 'Salvando…' : 'Salvar'}
            </PrimaryButton>
          </div>
          {dirty && invalid && <span className="text-sm text-danger">{invalid}</span>}
          {saved && !dirty && <span className="text-sm text-success">Perfil salvo!</span>}
        </div>
      </div>

      <div>
        <span className={labelClass}>Prévia</span>
        <div className="sticky top-0">
          <ProfileView user={preview} />
        </div>
      </div>
    </div>
  )
}

/** The picked image as an upload body, or null (nothing picked, or too big: reported). */
export function imageForm(e: ChangeEvent<HTMLInputElement>, onError: (message: string) => void): FormData | null {
  const file = e.target.files?.[0]
  e.target.value = '' // allow picking the same file again
  if (!file) return null
  if (file.size > MAX_BYTES) {
    onError('A imagem passa de 8 MB.')
    return null
  }
  const body = new FormData()
  body.append('file', file)
  return body
}

export function ImageRow({
  label,
  busy,
  hasImage,
  onPick,
  onRemove
}: {
  label: string
  busy: boolean
  hasImage: boolean
  onPick(e: ChangeEvent<HTMLInputElement>): void
  onRemove(): void
}): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="rounded-control bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? 'Enviando…' : `Alterar ${label.toLowerCase()}`}
        </button>
        {hasImage && (
          <button type="button" disabled={busy} onClick={onRemove} className="text-sm text-fg-muted hover:text-fg">
            Remover
          </button>
        )}
        <input ref={input} type="file" accept={ACCEPT} hidden aria-label={`Arquivo de ${label.toLowerCase()}`} onChange={onPick} />
      </div>
    </div>
  )
}
