import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { api, ApiError, type Me } from '../lib/api'
import { FormError } from './Modal'
import { ProfileView } from './ProfileCard'
import { Field, PrimaryButton } from './ui'

const MAX_BYTES = 8 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
const SWATCHES = ['#d4a72c', '#f23f43', '#f47b67', '#3ba55c', '#1abc9c', '#5865f2', '#9b59b6', '#eb459e']

function uploadError(err: unknown): string {
  if (err instanceof ApiError && err.status === 413) return 'A imagem passa de 8 MB.'
  if (err instanceof ApiError && err.status === 415) return 'Formato não suportado. Use PNG, JPG, GIF ou WebP.'
  return 'Não foi possível enviar a imagem.'
}

export function ProfileSettings({ user }: { user: Me }): ReactNode {
  const { setUser } = useAuth()
  const [form, setForm] = useState({
    display_name: user.display_name,
    bio: user.bio ?? '',
    accent_color: user.accent_color
  })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const dirty =
    form.display_name.trim() !== user.display_name ||
    (form.bio.trim() || null) !== user.bio ||
    form.accent_color !== user.accent_color
  const preview = { ...user, display_name: form.display_name.trim() || user.display_name, bio: form.bio.trim() || null, accent_color: form.accent_color }

  async function run(label: string, action: () => Promise<Me>): Promise<void> {
    setBusy(label)
    setError(null)
    setSaved(false)
    try {
      setUser(await action())
      if (label === 'save') setSaved(true)
    } catch (err) {
      setError(label === 'save' ? 'Não foi possível salvar.' : uploadError(err))
    } finally {
      setBusy(null)
    }
  }

  function pickImage(kind: 'avatar' | 'banner') {
    return (e: ChangeEvent<HTMLInputElement>): void => {
      const file = e.target.files?.[0]
      e.target.value = '' // allow picking the same file again
      if (!file) return
      if (file.size > MAX_BYTES) return setError('A imagem passa de 8 MB.')
      const body = new FormData()
      body.append('file', file)
      void run(kind, () => api<Me>(`/users/me/${kind}`, { method: 'POST', body }))
    }
  }

  const save = (): Promise<void> =>
    run('save', () =>
      api<Me>('/users/me', {
        method: 'PATCH',
        body: { display_name: form.display_name.trim(), bio: form.bio.trim() || null, accent_color: form.accent_color }
      })
    )

  return (
    <div className="grid grid-cols-[1fr_300px] gap-6">
      <div className="space-y-4">
        <FormError message={error} />
        <ImageRow label="Avatar" busy={busy === 'avatar'} hasImage={!!user.avatar_url} onPick={pickImage('avatar')}
          onRemove={() => run('avatar', () => api<Me>('/users/me/avatar', { method: 'DELETE' }))} />
        <ImageRow label="Banner" busy={busy === 'banner'} hasImage={!!user.banner_url} onPick={pickImage('banner')}
          onRemove={() => run('banner', () => api<Me>('/users/me/banner', { method: 'DELETE' }))} />
        <p className="-mt-2 text-xs text-fg-subtle">PNG, JPG, GIF ou WebP de até 8 MB. GIFs e WebPs animados continuam animados.</p>

        <Field label="Nome de exibição" maxLength={64} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />

        <label className="block">
          <span className="mb-2 flex justify-between text-xs font-bold uppercase tracking-wide text-fg-muted">
            Sobre mim <span className="font-normal normal-case">{form.bio.length}/190</span>
          </span>
          <textarea
            rows={3}
            maxLength={190}
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            placeholder="Conte um pouco sobre você"
            className="w-full resize-none rounded-[3px] bg-surface-0 px-3 py-2.5 text-[15px] text-fg outline-none placeholder:text-fg-subtle focus:ring-2 focus:ring-accent/60"
          />
        </label>

        <div>
          <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-fg-muted">Cor de destaque</span>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                onClick={() => setForm({ ...form, accent_color: c })}
                className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-surface-2 ${form.accent_color === c ? 'ring-2 ring-fg' : ''}`}
                style={{ background: c }}
              />
            ))}
            <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]" title="Outra cor">
              <input type="color" value={form.accent_color ?? '#d4a72c'} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            {form.accent_color && (
              <button type="button" onClick={() => setForm({ ...form, accent_color: null })} className="text-xs text-fg-subtle hover:text-fg">
                Remover cor
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-40">
            <PrimaryButton type="button" disabled={!dirty || !form.display_name.trim() || busy !== null} onClick={save}>
              {busy === 'save' ? 'Salvando…' : 'Salvar'}
            </PrimaryButton>
          </div>
          {saved && !dirty && <span className="text-sm text-green-400">Perfil salvo!</span>}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-fg-muted">Prévia</span>
        <ProfileView user={preview} />
      </div>
    </div>
  )
}

function ImageRow({
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
      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-fg-muted">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="rounded-[3px] bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
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
