import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { CodeInput } from '../components/AccountScreens'
import { FormError, SecondaryButton } from '../components/Modal'
import { Field, PrimaryButton } from '../components/ui'
import { accountMessage } from '../lib/accountErrors'
import { ApiError, authConfig, checkServer, forgotPassword, getApiBaseUrl, resetPassword, setApiBaseUrl } from '../lib/api'

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
      return String(err.detail ?? '').includes('required') ? { invite: 'obrigatório' } : { invite: accountMessage(err) }
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
  const { login, register, reload } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [forgot, setForgot] = useState(false)
  // Sign-up asks for an account invite while the server is invite-only (the default).
  const [inviteOnly, setInviteOnly] = useState(true)
  const [server, setServer] = useState(getApiBaseUrl())
  const [form, setForm] = useState({ username: '', display_name: '', email: '', password: '', confirm: '', invite: '' })
  const [errors, setErrors] = useState<Errors>(
    serverUnreachable ? { form: `Não foi possível conectar ao servidor em ${getApiBaseUrl()}.` } : {}
  )
  const [busy, setBusy] = useState(false)
  const [showServer, setShowServer] = useState(!!serverUnreachable)

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  useEffect(() => {
    authConfig().then(
      (c) => setInviteOnly(c.invite_only),
      () => setInviteOnly(true)
    )
  }, [server])

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
          invite_code: (inviteOnly && form.invite.trim()) || undefined
        })
      }
    } catch (err) {
      setErrors(describeError(err, mode))
      setBusy(false)
    }
  }

  if (forgot) {
    return <ForgotPassword initialEmail={form.email} onBack={() => setForgot(false)} onDone={reload} />
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
              {inviteOnly && (
                <Field
                  label="Convite"
                  value={form.invite}
                  onChange={set('invite')}
                  error={errors.invite}
                  hint="Cole o link ou o código que você recebeu. O beta é fechado: só entra quem tem convite."
                  maxLength={200}
                />
              )}
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

          {mode === 'login' && (
            <button type="button" className="-mt-2 text-sm font-medium text-accent-text hover:underline" onClick={() => setForgot(true)}>
              Esqueci minha senha
            </button>
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
          {showServer && (
            <ServerSettings
              onSaved={() => {
                setErrors({})
                setServer(getApiBaseUrl())
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** "Esqueci minha senha": a code by e-mail, then the new password (which signs in and ends the
 * other sessions). The first step says the same whether or not the address has an account. */
export function ForgotPassword({
  initialEmail,
  onBack,
  onDone
}: {
  initialEmail: string
  onBack(): void
  onDone(): Promise<void>
}): ReactNode {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!EMAIL_RE.test(email.trim())) return setError('Digite um e-mail válido.')
    setBusy(true)
    setError(null)
    try {
      await forgotPassword(email.trim())
      setStep('code')
    } catch (err) {
      setError(accountMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function reset(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (code.length !== 6) return setError('Digite os 6 números do código.')
    if (password.length < 8) return setError('A senha nova precisa de pelo menos 8 caracteres.')
    if (password !== confirm) return setError('As senhas não coincidem.')
    setBusy(true)
    setError(null)
    try {
      await resetPassword(email.trim(), code, password)
      await onDone()
    } catch (err) {
      setError(accountMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-glow p-6">
      <div className="w-full max-w-[480px] rounded-panel border border-line bg-panel p-8 shadow-2xl">
        <h1 className="text-center text-2xl font-semibold">Esqueci minha senha</h1>
        <p className="mt-2 text-center text-fg-muted">
          {step === 'email'
            ? 'Mandamos um código pro e-mail da sua conta.'
            : `Se existe uma conta com ${email.trim()}, o código chegou lá. Vale por 15 minutos.`}
        </p>
        {step === 'email' ? (
          <form className="mt-6 space-y-4" onSubmit={send} noValidate>
            <FormError message={error} />
            <Field label="E-mail" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? 'Aguarde…' : 'Mandar código'}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={onBack}>
              Voltar
            </SecondaryButton>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={reset} noValidate>
            <FormError message={error} />
            <CodeInput value={code} onChange={setCode} autoFocus />
            <Field
              label="Senha nova"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="Ao trocar, as outras sessões da conta são encerradas."
            />
            <Field label="Repita a senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? 'Salvando…' : 'Trocar senha e entrar'}
            </PrimaryButton>
            <SecondaryButton
              type="button"
              onClick={() => {
                setStep('email')
                setError(null)
              }}
            >
              Usar outro e-mail
            </SecondaryButton>
          </form>
        )}
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
