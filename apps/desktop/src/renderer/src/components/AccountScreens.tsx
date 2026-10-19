import { MailCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { accountMessage, codeDigits } from '../lib/accountErrors'
import { ApiError, changePassword, changePendingEmail, resendCode, verifyEmail, type Confirmation, type Me } from '../lib/api'
import { BadgeIcon, useShownBadges } from './Badge'
import { FormError, SecondaryButton } from './Modal'
import { Field, inputClass, labelClass, PrimaryButton } from './ui'

const RESEND_SECONDS = 60

/** Full-window card used by the account screens (same frame as sign-in). */
function Card({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className="flex h-full items-center justify-center bg-glow p-6">
      <div className="w-full max-w-[480px] rounded-panel border border-line bg-panel p-8 shadow-2xl">
        <h1 className="text-center text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-2 text-center text-fg-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}

/** The 6-digit code field: digits only, pasting "482 913" works, one-time-code autofill. */
export function CodeInput({ value, onChange, autoFocus }: { value: string; onChange(value: string): void; autoFocus?: boolean }): ReactNode {
  return (
    <label className="block">
      <span className={labelClass}>Código do e-mail</span>
      <input
        value={value}
        onChange={(e) => onChange(codeDigits(e.target.value))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        placeholder="000000"
        aria-label="Código de 6 dígitos"
        className={`${inputClass} text-center font-display text-2xl tracking-[0.4em]`}
      />
    </label>
  )
}

/** Counts down to when another code may be asked for, from `sentAt` (when the last one went). */
export function useResendTimer(sentAt = Date.now()): [number, (seconds?: number) => void] {
  const [until, setUntil] = useState(() => sentAt + RESEND_SECONDS * 1000)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return [left, (seconds = RESEND_SECONDS) => setUntil(Date.now() + seconds * 1000)]
}

function retryAfter(err: unknown): number | null {
  return err instanceof ApiError && err.status === 429 ? RESEND_SECONDS : null
}

/** Shown after sign-up (and from the reminder) until the e-mail is confirmed. */
export function VerifyEmailScreen({ user, onLater }: { user: Me; onLater(): void }): ReactNode {
  const { setUser, logout } = useAuth()
  const [code, setCode] = useState('')
  const [email, setEmail] = useState(user.email)
  const [editing, setEditing] = useState(false)
  const [newEmail, setNewEmail] = useState(user.email)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Sign-up sent the first code: right after it, wait; when reopened later, resend at once.
  const [left, restart] = useResendTimer(Date.parse(user.created_at))
  const [done, setDone] = useState<Confirmation | null>(null)

  async function confirm(e?: FormEvent): Promise<void> {
    e?.preventDefault()
    if (code.length !== 6) return setError('Digite os 6 números do código.')
    setBusy(true)
    setError(null)
    try {
      setDone(await verifyEmail(code))
    } catch (err) {
      setError(accountMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  async function resend(): Promise<void> {
    setError(null)
    try {
      await resendCode()
      restart()
      setInfo('Mandamos um código novo.')
    } catch (err) {
      const wait = retryAfter(err)
      if (wait) restart(wait)
      setError(accountMessage(err))
    }
  }

  async function saveEmail(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const me = await changePendingEmail(newEmail.trim())
      setEmail(me.email)
      setUser(me)
      setEditing(false)
      setCode('')
      restart()
      setInfo('Mandamos o código pro e-mail novo.')
    } catch (err) {
      setError(accountMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (done) return <Confirmed result={done} onContinue={() => setUser(done.user)} />

  if (editing) {
    return (
      <Card title="Trocar e-mail" subtitle="O código vai pro endereço novo.">
        <form className="space-y-4" onSubmit={saveEmail} noValidate>
          <FormError message={error} />
          <Field label="E-mail certo" type="email" autoFocus value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <PrimaryButton type="submit" disabled={busy}>{busy ? 'Aguarde…' : 'Mandar o código'}</PrimaryButton>
          <SecondaryButton type="button" onClick={() => setEditing(false)}>Voltar</SecondaryButton>
        </form>
      </Card>
    )
  }

  return (
    <Card title="Confira seu e-mail" subtitle={<>Mandamos um código de 6 dígitos para <b className="break-all text-fg">{email}</b>.</>}>
      <form className="space-y-4" onSubmit={confirm} noValidate>
        <FormError message={error} />
        {info && !error && <p className="text-sm text-success">{info}</p>}
        <CodeInput value={code} onChange={setCode} autoFocus />
        <p className="text-center text-sm text-fg-muted">
          Vale por 15 minutos ·{' '}
          <button type="button" disabled={left > 0} onClick={() => void resend()} className="font-medium text-accent-text hover:underline disabled:text-fg-subtle disabled:no-underline">
            {left > 0 ? `reenviar em 0:${String(left).padStart(2, '0')}` : 'reenviar código'}
          </button>
        </p>
        <p className="rounded-control border border-line bg-main px-3 py-2.5 text-sm text-fg-muted">
          Não chegou? Olhe o spam ou a aba Promoções. O remetente é <b className="text-fg">Aureum</b>.
        </p>
        <PrimaryButton type="submit" disabled={busy}>{busy ? 'Confirmando…' : 'Confirmar'}</PrimaryButton>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => { setEditing(true); setError(null) }}>
          Trocar e-mail
        </button>
        <span className="flex gap-4">
          <button type="button" className="text-fg-muted hover:text-fg" onClick={onLater}>Agora não</button>
          <button type="button" className="text-fg-muted hover:text-fg" onClick={() => void logout()}>Sair</button>
        </span>
      </div>
    </Card>
  )
}

/** What confirming brought: the Pioneiro number (during the beta) and the invites. */
function Confirmed({ result, onContinue }: { result: Confirmation; onContinue(): void }): ReactNode {
  const pioneer = useShownBadges(result.user.badges.filter((b) => b.key === 'pioneer'))[0]
  return (
    <Card title={`Tudo pronto, @${result.user.username}.`} subtitle="Seu e-mail está confirmado.">
      <div className="space-y-4">
        {result.pioneer_number != null && (
          <div className="flex flex-col items-center rounded-panel border border-accent/40 bg-main p-5 text-center">
            {pioneer && <BadgeIcon shown={pioneer} size={96} shine="always" />}
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-accent-text">Insígnia mítica</p>
            <p className="font-display text-2xl font-semibold">
              Pioneiro <span className="text-accent-text">nº {String(result.pioneer_number).padStart(2, '0')}</span>
            </p>
            <p className="mt-1 text-sm text-fg-muted">Já está no seu perfil, pra sempre.</p>
          </div>
        )}
        <ul className="space-y-2 text-sm text-fg-muted">
          {result.joined_official && <li>Você já está no servidor do beta.</li>}
          {result.invites > 0 && (
            <li>
              Você ganhou <b className="text-fg">{result.invites} convites</b>: estão em Configurações › Convites.
            </li>
          )}
        </ul>
        <PrimaryButton type="button" onClick={onContinue}>Entrar no Aureum</PrimaryButton>
      </div>
    </Card>
  )
}

/** Accounts made by the admin with a temporary password replace it before anything else. */
export function ForcePasswordScreen(): ReactNode {
  const { reload, logout } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (password.length < 8) return setError('A senha precisa de pelo menos 8 caracteres.')
    if (password !== confirm) return setError('As senhas não coincidem.')
    setBusy(true)
    setError(null)
    try {
      await changePassword(password)
      await reload()
    } catch (err) {
      setError(accountMessage(err))
      setBusy(false)
    }
  }

  return (
    <Card title="Crie sua senha" subtitle="Sua conta foi criada com uma senha temporária. Escolha a sua pra continuar.">
      <form className="space-y-4" onSubmit={submit} noValidate>
        <FormError message={error} />
        <Field label="Senha nova" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} hint="Pelo menos 8 caracteres." />
        <Field label="Repita a senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar e continuar'}</PrimaryButton>
      </form>
      <button type="button" className="mt-4 text-sm text-fg-muted hover:text-fg" onClick={() => void logout()}>
        Sair
      </button>
    </Card>
  )
}

/** A small reminder over the app while the e-mail isn't confirmed. */
export function VerifyReminder({ onOpen }: { onOpen(): void }): ReactNode {
  return (
    <div role="status" className="app-no-drag fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-control border border-line bg-panel px-4 py-2.5 text-sm shadow-xl">
      <MailCheck size={16} className="shrink-0 text-accent-text" />
      <span className="text-fg-muted">Confirme seu e-mail pra criar servidores e ganhar seus convites.</span>
      <button type="button" onClick={onOpen} className="font-medium text-accent-text hover:underline">
        Confirmar agora
      </button>
    </div>
  )
}
