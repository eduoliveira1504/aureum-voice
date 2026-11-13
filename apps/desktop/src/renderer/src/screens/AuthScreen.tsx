import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../auth/AuthProvider'
import { CodeInput } from '../components/AccountScreens'
import { FormError, SecondaryButton } from '../components/Modal'
import { Field, PrimaryButton } from '../components/ui'
import { accountMessage, serverNotice } from '../lib/accountErrors'
import { ApiError, authConfig, checkServer, forgotPassword, getApiBaseUrl, resetPassword, setApiBaseUrl } from '../lib/api'
import { t } from '../lib/i18n'

type Mode = 'login' | 'register'
type Errors = Partial<Record<'username' | 'email' | 'password' | 'confirm' | 'invite' | 'form', string>>

const USERNAME_RE = /^[A-Za-z0-9_.]{3,32}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(mode: Mode, f: Record<string, string>): Errors {
  const e: Errors = {}
  if (!EMAIL_RE.test(f.email)) e.email = t('auth.validation.email')
  if (mode === 'login') {
    if (!f.password) e.password = t('auth.validation.required')
    return e
  }
  if (!USERNAME_RE.test(f.username)) e.username = t('auth.validation.username')
  if (f.password.length < 8) e.password = t('auth.validation.passwordShort')
  else if (f.password.length > 128) e.password = t('auth.validation.passwordLong')
  if (f.confirm !== f.password) e.confirm = t('auth.validation.mismatch')
  return e
}

function describeError(err: unknown, mode: Mode): Errors {
  const notice = serverNotice(err)
  if (notice) return { form: notice }
  if (err instanceof ApiError) {
    if (err.status === 401 && mode === 'login') return { form: t('auth.errors.wrongLogin') }
    if (err.status === 429) return { form: t('auth.errors.tooMany') }
    if (err.status === 403 && mode === 'register') {
      return String(err.detail ?? '').includes('required') ? { invite: t('auth.validation.required') } : { invite: accountMessage(err) }
    }
    if (err.status === 409) {
      const detail = String(err.detail ?? '')
      if (detail.includes('reserved')) return { username: t('auth.validation.reserved') }
      if (detail.includes('username')) return { username: t('auth.validation.taken') }
      if (detail.includes('email')) return { email: t('auth.validation.taken') }
      return { form: t('auth.errors.taken') }
    }
    if (err.status === 422) return { form: t('auth.errors.invalid') }
    return { form: t('errors.unexpected', { status: err.status }) }
  }
  return { form: t('errors.unreachable', { url: getApiBaseUrl() }) }
}

export function AuthScreen({
  serverUnreachable,
  serverMessage
}: {
  serverUnreachable?: boolean
  /** The server's own words when it's out of service on purpose (e.g. it moved). */
  serverMessage?: string
}): ReactNode {
  const { t } = useTranslation()
  const { login, register, reload } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [forgot, setForgot] = useState(false)
  // Sign-up asks for an account invite while the server is invite-only (the default).
  const [inviteOnly, setInviteOnly] = useState(true)
  const [server, setServer] = useState(getApiBaseUrl())
  const [form, setForm] = useState({ username: '', display_name: '', email: '', password: '', confirm: '', invite: '' })
  const [errors, setErrors] = useState<Errors>(
    serverMessage
      ? { form: serverMessage }
      : serverUnreachable
        ? { form: t('errors.unreachable', { url: getApiBaseUrl() }) }
        : {}
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
          {mode === 'login' ? t('auth.welcomeBack') : t('auth.createAccount')}
        </h1>
        <p className="mt-2 text-center text-fg-muted">
          {mode === 'login' ? t('auth.welcomeBackHint') : t('auth.createAccountHint')}
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
          {errors.form && (
            <div role="alert" className="rounded-control border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-fg">
              {errors.form}
            </div>
          )}

          <Field label={t('auth.email')} type="email" autoComplete="email" autoFocus value={form.email} onChange={set('email')} error={errors.email} />

          {mode === 'register' && (
            <>
              {inviteOnly && (
                <Field
                  label={t('auth.invite')}
                  value={form.invite}
                  onChange={set('invite')}
                  error={errors.invite}
                  hint={t('auth.inviteHint')}
                  maxLength={200}
                />
              )}
              <Field label={t('auth.displayName')} value={form.display_name} onChange={set('display_name')} hint={t('auth.displayNameHint')} maxLength={64} />
              <Field label={t('auth.username')} autoComplete="username" value={form.username} onChange={set('username')} error={errors.username} hint={t('auth.usernameHint')} maxLength={32} />
            </>
          )}

          <Field
            label={t('auth.password')}
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={form.password}
            onChange={set('password')}
            error={errors.password}
          />

          {mode === 'register' && (
            <Field label={t('auth.confirmPassword')} type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
          )}

          {mode === 'login' && (
            <button type="button" className="-mt-2 text-sm font-medium text-accent-text hover:underline" onClick={() => setForgot(true)}>
              {t('auth.forgotPassword')}
            </button>
          )}

          <PrimaryButton type="submit" disabled={busy}>
            {busy ? t('auth.wait') : mode === 'login' ? t('auth.signIn') : t('auth.continue')}
          </PrimaryButton>
        </form>

        <p className="mt-3 text-sm text-fg-subtle">
          {mode === 'login' ? t('auth.needAccount') : t('auth.haveAccount')}{' '}
          <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? t('auth.signUp') : t('auth.signIn')}
          </button>
        </p>

        <div className="mt-6 border-t border-line pt-4">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-fg-subtle hover:text-fg-muted"
            onClick={() => setShowServer((v) => !v)}
          >
            {showServer ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t('auth.server', { url: getApiBaseUrl() })}
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
  const { t } = useTranslation()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!EMAIL_RE.test(email.trim())) return setError(t('auth.forgot.invalidEmail'))
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
    if (code.length !== 6) return setError(t('auth.forgot.codeDigits'))
    if (password.length < 8) return setError(t('auth.forgot.short'))
    if (password !== confirm) return setError(t('auth.forgot.mismatch'))
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
        <h1 className="text-center text-2xl font-semibold">{t('auth.forgotPassword')}</h1>
        <p className="mt-2 text-center text-fg-muted">
          {step === 'email'
            ? t('auth.forgot.emailStep')
            : t('auth.forgot.codeStep', { email: email.trim() })}
        </p>
        {step === 'email' ? (
          <form className="mt-6 space-y-4" onSubmit={send} noValidate>
            <FormError message={error} />
            <Field label={t('auth.email')} type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? t('auth.wait') : t('auth.forgot.send')}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={onBack}>
              {t('common.back')}
            </SecondaryButton>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={reset} noValidate>
            <FormError message={error} />
            <CodeInput value={code} onChange={setCode} autoFocus />
            <Field
              label={t('auth.forgot.newPassword')}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint={t('auth.forgot.newPasswordHint')}
            />
            <Field label={t('auth.forgot.repeat')} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('auth.forgot.submit')}
            </PrimaryButton>
            <SecondaryButton
              type="button"
              onClick={() => {
                setStep('email')
                setError(null)
              }}
            >
              {t('auth.forgot.otherEmail')}
            </SecondaryButton>
          </form>
        )}
      </div>
    </div>
  )
}

function ServerSettings({ onSaved }: { onSaved(): void }): ReactNode {
  const { t } = useTranslation()
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
        setStatus({ ok: false, text: t('auth.serverSettings.noHealth') })
        return
      }
      const saved = await window.aureum.settings.set({ apiUrl: candidate })
      setApiBaseUrl(saved.apiUrl)
      setUrl(saved.apiUrl)
      setStatus({ ok: true, text: t('auth.serverSettings.saved') })
      onSaved()
    } catch {
      setStatus({ ok: false, text: t('auth.serverSettings.invalid') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="mt-3 flex items-end gap-2" onSubmit={save}>
      <div className="flex-1">
        <Field label={t('auth.serverSettings.url')} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8000" />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="rounded-control border border-line bg-elevated px-4 py-2.5 text-[15px] font-medium hover:bg-line disabled:opacity-60"
      >
        {busy ? t('auth.serverSettings.testing') : t('common.save')}
      </button>
      {status && (
        <span className={`basis-full text-xs ${status.ok ? 'text-success' : 'text-danger'}`}>{status.text}</span>
      )}
    </form>
  )
}
