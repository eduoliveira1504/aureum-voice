import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { accountMessage } from '../lib/accountErrors'
import { changePassword, confirmEmailChange, myInvites, requestEmailChange, type Me, type MyInvite } from '../lib/api'
import { CodeInput } from './AccountScreens'
import { FormError, SecondaryButton } from './Modal'
import { Field, labelClass, PrimaryButton } from './ui'

/** Configurações › Conta: the sign-in e-mail and the password. */
export function AccountSettings({ user }: { user: Me }): ReactNode {
  return (
    <div className="max-w-[440px] space-y-8">
      <EmailSection user={user} />
      <PasswordSection />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="space-y-4">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function EmailSection({ user }: { user: Me }): ReactNode {
  const { setUser } = useAuth()
  const [step, setStep] = useState<'idle' | 'form' | 'code'>('idle')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function request(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await requestEmailChange(email.trim(), password)
      setPassword('')
      setStep('code')
    } catch (err) {
      setError(accountMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (code.length !== 6) return setError('Digite os 6 números do código.')
    setBusy(true)
    setError(null)
    try {
      setUser(await confirmEmailChange(code))
      setStep('idle')
      setCode('')
      setDone(true)
    } catch (err) {
      setError(accountMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="E-mail">
      <div>
        <span className={labelClass}>E-mail da conta</span>
        <p className="break-all text-[15px]">{user.email}</p>
        {done && <p className="mt-1 text-sm text-success">E-mail trocado. Avisamos o endereço antigo.</p>}
      </div>
      {step === 'idle' && (
        <SecondaryButton type="button" onClick={() => { setStep('form'); setDone(false) }}>
          Trocar e-mail
        </SecondaryButton>
      )}
      {step === 'form' && (
        <form className="space-y-4" onSubmit={request} noValidate>
          <FormError message={error} />
          <Field label="E-mail novo" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label="Sua senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="Pra confirmar que é você." />
          <PrimaryButton type="submit" disabled={busy}>{busy ? 'Aguarde…' : 'Mandar código pro e-mail novo'}</PrimaryButton>
          <SecondaryButton type="button" onClick={() => { setStep('idle'); setError(null) }}>Cancelar</SecondaryButton>
        </form>
      )}
      {step === 'code' && (
        <form className="space-y-4" onSubmit={confirm} noValidate>
          <p className="text-sm text-fg-muted">
            Mandamos um código para <b className="break-all text-fg">{email.trim()}</b>. O e-mail da conta só muda depois de confirmar.
          </p>
          <FormError message={error} />
          <CodeInput value={code} onChange={setCode} autoFocus />
          <PrimaryButton type="submit" disabled={busy}>{busy ? 'Confirmando…' : 'Confirmar e-mail novo'}</PrimaryButton>
          <SecondaryButton type="button" onClick={() => { setStep('idle'); setError(null) }}>Cancelar</SecondaryButton>
        </form>
      )}
    </Section>
  )
}

function PasswordSection(): ReactNode {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (next.length < 8) return setError('A senha nova precisa de pelo menos 8 caracteres.')
    if (next !== repeat) return setError('As senhas não coincidem.')
    setBusy(true)
    setError(null)
    try {
      await changePassword(next, current)
      setOpen(false)
      setCurrent('')
      setNext('')
      setRepeat('')
      setDone(true)
    } catch (err) {
      setError(accountMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Senha">
      {done && <p className="text-sm text-success">Senha trocada. As outras sessões foram encerradas.</p>}
      {!open ? (
        <SecondaryButton type="button" onClick={() => { setOpen(true); setDone(false) }}>
          Trocar senha
        </SecondaryButton>
      ) : (
        <form className="space-y-4" onSubmit={submit} noValidate>
          <FormError message={error} />
          <Field label="Senha atual" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Field label="Senha nova" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint="Ao trocar, as outras sessões da conta são encerradas." />
          <Field label="Repita a senha nova" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          <PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Trocar senha'}</PrimaryButton>
          <SecondaryButton type="button" onClick={() => { setOpen(false); setError(null) }}>Cancelar</SecondaryButton>
        </form>
      )}
    </Section>
  )
}

const INVITE_STATUS: Record<MyInvite['status'], string> = {
  free: 'Livre',
  pending: 'Aguardando confirmação',
  used: 'Usado'
}

/** Configurações › Convites: the user's single-use links to the invite page. */
export function InvitesSettings({ user }: { user: Me }): ReactNode {
  const [invites, setInvites] = useState<MyInvite[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!user.email_verified || user.is_official) return
    myInvites().then(setInvites, (err) => setError(accountMessage(err)))
  }, [user.email_verified, user.is_official])

  if (user.is_official) return <p className="text-sm text-fg-muted">Contas oficiais não têm convites.</p>
  if (!user.email_verified) {
    return <p className="text-sm text-fg-muted">Confirme seu e-mail pra ganhar seus convites.</p>
  }

  async function copy(invite: MyInvite): Promise<void> {
    await navigator.clipboard.writeText(invite.url)
    setCopied(invite.code)
    setTimeout(() => setCopied((c) => (c === invite.code ? null : c)), 2000)
  }

  return (
    <div className="max-w-[520px] space-y-4">
      <p className="text-sm text-fg-muted">
        O beta é fechado: só entra quem recebe convite. Cada link vale pra uma pessoa, e conta como usado quando ela confirma o e-mail.
      </p>
      <FormError message={error} />
      {invites === null && !error && <p className="text-sm text-fg-subtle">Carregando…</p>}
      {invites?.length === 0 && <p className="text-sm text-fg-muted">Você não tem convites.</p>}
      <ul className="space-y-2">
        {invites?.map((invite) => (
          <li key={invite.code} className="flex items-center gap-3 rounded-control border border-line bg-main px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-semibold tracking-[0.12em]">{invite.code}</p>
              <p className="truncate text-xs text-fg-muted">
                {INVITE_STATUS[invite.status]}
                {invite.used_by && ` · @${invite.used_by.username}`}
              </p>
            </div>
            {invite.status === 'free' && (
              <button
                type="button"
                onClick={() => void copy(invite)}
                className="flex shrink-0 items-center gap-1.5 rounded-control bg-elevated px-3 py-1.5 text-sm font-medium hover:bg-line"
              >
                {copied === invite.code ? <Check size={14} /> : <Copy size={14} />}
                {copied === invite.code ? 'Copiado' : 'Copiar link'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
