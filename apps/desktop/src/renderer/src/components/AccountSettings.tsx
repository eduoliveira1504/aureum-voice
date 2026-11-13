import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { useAuth } from '../auth/AuthProvider'
import { accountMessage } from '../lib/accountErrors'
import { changePassword, confirmEmailChange, myInvites, requestEmailChange, type Me, type MyInvite } from '../lib/api'
import { DeleteAccountSettings } from './AccountDeletion'
import { CodeInput } from './AccountScreens'
import { FormError, SecondaryButton } from './Modal'
import { Field, labelClass, PrimaryButton } from './ui'

/** Editar perfil › Conta: the sign-in e-mail, the password, and deactivating or deleting the account. */
export function AccountSettings({ user }: { user: Me }): ReactNode {
  return (
    <div className="max-w-[440px] space-y-8">
      <EmailSection user={user} />
      <PasswordSection />
      <DeleteAccountSettings />
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
  const { t } = useTranslation()
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
    if (code.length !== 6) return setError(t('account.verify.codeDigits'))
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
    <Section title={t('account.email.title')}>
      <div>
        <span className={labelClass}>{t('account.email.current')}</span>
        <p className="break-all text-[15px]">{user.email}</p>
        {done && <p className="mt-1 text-sm text-success">{t('account.email.changed')}</p>}
      </div>
      {step === 'idle' && (
        <SecondaryButton type="button" onClick={() => { setStep('form'); setDone(false) }}>
          {t('account.email.change')}
        </SecondaryButton>
      )}
      {step === 'form' && (
        <form className="space-y-4" onSubmit={request} noValidate>
          <FormError message={error} />
          <Field label={t('account.email.new')} type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label={t('account.email.password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} hint={t('account.email.passwordHint')} />
          <PrimaryButton type="submit" disabled={busy}>{busy ? t('auth.wait') : t('account.email.send')}</PrimaryButton>
          <SecondaryButton type="button" onClick={() => { setStep('idle'); setError(null) }}>{t('common.cancel')}</SecondaryButton>
        </form>
      )}
      {step === 'code' && (
        <form className="space-y-4" onSubmit={confirm} noValidate>
          <p className="text-sm text-fg-muted">
            <Trans i18nKey="account.email.sent" values={{ email: email.trim() }} components={{ b: <b className="break-all text-fg" /> }} />
          </p>
          <FormError message={error} />
          <CodeInput value={code} onChange={setCode} autoFocus />
          <PrimaryButton type="submit" disabled={busy}>{busy ? t('account.verify.confirming') : t('account.email.confirm')}</PrimaryButton>
          <SecondaryButton type="button" onClick={() => { setStep('idle'); setError(null) }}>{t('common.cancel')}</SecondaryButton>
        </form>
      )}
    </Section>
  )
}

function PasswordSection(): ReactNode {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (next.length < 8) return setError(t('auth.forgot.short'))
    if (next !== repeat) return setError(t('auth.forgot.mismatch'))
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
    <Section title={t('account.password.title')}>
      {done && <p className="text-sm text-success">{t('account.password.changed')}</p>}
      {!open ? (
        <SecondaryButton type="button" onClick={() => { setOpen(true); setDone(false) }}>
          {t('account.password.change')}
        </SecondaryButton>
      ) : (
        <form className="space-y-4" onSubmit={submit} noValidate>
          <FormError message={error} />
          <Field label={t('account.password.current')} type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Field label={t('auth.forgot.newPassword')} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint={t('auth.forgot.newPasswordHint')} />
          <Field label={t('account.password.repeat')} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          <PrimaryButton type="submit" disabled={busy}>{busy ? t('common.saving') : t('account.password.change')}</PrimaryButton>
          <SecondaryButton type="button" onClick={() => { setOpen(false); setError(null) }}>{t('common.cancel')}</SecondaryButton>
        </form>
      )}
    </Section>
  )
}

/** Configurações › Convites: the user's single-use links to the invite page. */
export function InvitesSettings({ user }: { user: Me }): ReactNode {
  const { t } = useTranslation()
  const [invites, setInvites] = useState<MyInvite[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!user.email_verified || user.is_official) return
    myInvites().then(setInvites, (err) => setError(accountMessage(err)))
  }, [user.email_verified, user.is_official])

  if (user.is_official) return <p className="text-sm text-fg-muted">{t('account.invites.official')}</p>
  if (!user.email_verified) {
    return <p className="text-sm text-fg-muted">{t('account.invites.confirmFirst')}</p>
  }

  async function copy(invite: MyInvite): Promise<void> {
    await navigator.clipboard.writeText(invite.url)
    setCopied(invite.code)
    setTimeout(() => setCopied((c) => (c === invite.code ? null : c)), 2000)
  }

  return (
    <div className="max-w-[520px] space-y-4">
      <p className="text-sm text-fg-muted">
        {t('account.invites.intro')}
      </p>
      <FormError message={error} />
      {invites === null && !error && <p className="text-sm text-fg-subtle">{t('common.loading')}</p>}
      {invites?.length === 0 && <p className="text-sm text-fg-muted">{t('account.invites.none')}</p>}
      <ul className="space-y-2">
        {invites?.map((invite) => (
          <li key={invite.code} className="flex items-center gap-3 rounded-control border border-line bg-main px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-semibold tracking-[0.12em]">{invite.code}</p>
              <p className="truncate text-xs text-fg-muted">
                {t(`account.invites.status.${invite.status}`)}
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
                {copied === invite.code ? t('common.copied') : t('account.invites.copyLink')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
