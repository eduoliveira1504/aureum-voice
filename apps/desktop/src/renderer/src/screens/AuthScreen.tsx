import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { Field, PrimaryButton } from '../components/ui'
import { ApiError, checkServer, getApiBaseUrl, setApiBaseUrl } from '../lib/api'

type Mode = 'login' | 'register'
type Errors = Partial<Record<'username' | 'email' | 'password' | 'confirm' | 'invite' | 'form', string>>

const USERNAME_RE = /^[A-Za-z0-9_.]{3,32}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(mode: Mode, f: Record<string, string>): Errors {
  const e: Errors = {}
  if (!EMAIL_RE.test(f.email)) e.email = 'e-mail inválido'
  if (mode === 'login') {
    if (!f.password) e.password = 'obrigatório'
    return e
  }
  if (!USERNAME_RE.test(f.username)) e.username = '3 a 32 caracteres: letras, números, _ e .'
  if (f.password.length < 8) e.password = 'mínimo de 8 caracteres'
  else if (f.password.length > 128) e.password = 'máximo de 128 caracteres'
  if (f.confirm !== f.password) e.confirm = 'as senhas não coincidem'
  return e
}

function describeError(err: unknown, mode: Mode): Errors {
  if (err instanceof ApiError) {
    if (err.status === 401 && mode === 'login') return { form: 'E-mail ou senha incorretos.' }
    if (err.status === 429) return { form: 'Muitas tentativas. Espere alguns minutos e tente de novo.' }
    if (err.status === 403 && mode === 'register') {
      return String(err.detail ?? '').includes('required')
        ? { invite: 'obrigatório' }
        : { invite: 'inválido, expirado ou já usado' }
    }
    if (err.status === 409) {
      const detail = String(err.detail ?? '')
      if (detail.includes('reserved')) return { username: 'esse nome é reservado' }
      if (detail.includes('username')) return { username: 'já está em uso' }
      if (detail.includes('email')) return { email: 'já está em uso' }
      return { form: 'Usuário ou e-mail já está em uso.' }
    }
    if (err.status === 422) return { form: 'Dados inválidos. Confira os campos.' }
    return { form: `Erro inesperado do servidor (${err.status}).` }
  }
  return { form: `Não foi possível conectar ao servidor em ${getApiBaseUrl()}.` }
}

export function AuthScreen({ serverUnreachable }: { serverUnreachable?: boolean }): ReactNode {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [form, setForm] = useState({ username: '', display_name: '', email: '', password: '', confirm: '', invite: '' })
  const [errors, setErrors] = useState<Errors>(
    serverUnreachable ? { form: `Não foi possível conectar ao servidor em ${getApiBaseUrl()}.` } : {}
  )
  const [busy, setBusy] = useState(false)
  const [showServer, setShowServer] = useState(!!serverUnreachable)

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const switchMode = (next: Mode): void => {
    setMode(next)
    setErrors({})
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const found = validate(mode, form)
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password)
      } else {
        await register({
          username: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
          display_name: form.display_name.trim() || undefined,
          invite_code: form.invite.trim() || undefined
        })
      }
    } catch (err) {
      setErrors(describeError(err, mode))
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-glow p-6">
      <div className="w-full max-w-[480px] rounded-panel border border-line bg-panel p-8 shadow-2xl">
        <h1 className="text-center text-2xl font-semibold">
          {mode === 'login' ? 'Boas-vindas de volta!' : 'Criar uma conta'}
        </h1>
        <p className="mt-2 text-center text-fg-muted">
          {mode === 'login' ? 'Que bom te ver de novo no Aureum.' : 'Entre pro grupo em poucos segundos.'}
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
          {errors.form && (
            <div role="alert" className="rounded-control border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-fg">
              {errors.form}
            </div>
          )}

          <Field label="E-mail" type="email" autoComplete="email" autoFocus value={form.email} onChange={set('email')} error={errors.email} />

          {mode === 'register' && (
            <>
              <Field
                label="Código de convite"
                value={form.invite}
                onChange={set('invite')}
                error={errors.invite}
                hint="Peça para quem administra o servidor. Você já entra nele ao criar a conta."
                maxLength={64}
              />
              <Field label="Nome de exibição" value={form.display_name} onChange={set('display_name')} hint="Como os outros te veem. Opcional." maxLength={64} />
              <Field label="Nome de usuário" autoComplete="username" value={form.username} onChange={set('username')} error={errors.username} hint="Letras, números, _ e ." maxLength={32} />
            </>
          )}

          <Field
            label="Senha"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={form.password}
            onChange={set('password')}
            error={errors.password}
          />

          {mode === 'register' && (
            <Field label="Confirmar senha" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
          )}

          <PrimaryButton type="submit" disabled={busy}>
            {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Continuar'}
          </PrimaryButton>
        </form>

        <p className="mt-3 text-sm text-fg-subtle">
          {mode === 'login' ? 'Precisa de uma conta? ' : 'Já tem uma conta? '}
          <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Registre-se' : 'Entrar'}
          </button>
        </p>

        <div className="mt-6 border-t border-line pt-4">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-fg-subtle hover:text-fg-muted"
            onClick={() => setShowServer((v) => !v)}
          >
            {showServer ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Servidor: {getApiBaseUrl()}
          </button>
          {showServer && <ServerSettings onSaved={() => setErrors({})} />}
        </div>
      </div>
    </div>
  )
}

function ServerSettings({ onSaved }: { onSaved(): void }): ReactNode {
  const [url, setUrl] = useState(getApiBaseUrl())
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setStatus(null)
    try {
      const candidate = new URL(url.trim()).origin
      if (!(await checkServer(candidate))) {
        setStatus({ ok: false, text: 'Servidor não respondeu em /api/health.' })
        return
      }
      const saved = await window.aureum.settings.set({ apiUrl: candidate })
      setApiBaseUrl(saved.apiUrl)
      setUrl(saved.apiUrl)
      setStatus({ ok: true, text: 'Conectado e salvo.' })
      onSaved()
    } catch {
      setStatus({ ok: false, text: 'URL inválida. Ex.: http://localhost:8000' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="mt-3 flex items-end gap-2" onSubmit={save}>
      <div className="flex-1">
        <Field label="URL da API" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8000" />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="rounded-control border border-line bg-elevated px-4 py-2.5 text-[15px] font-medium hover:bg-line disabled:opacity-60"
      >
        {busy ? 'Testando…' : 'Salvar'}
      </button>
      {status && (
        <span className={`basis-full text-xs ${status.ok ? 'text-success' : 'text-danger'}`}>{status.text}</span>
      )}
    </form>
  )
}
