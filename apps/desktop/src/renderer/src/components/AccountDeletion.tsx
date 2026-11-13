import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../auth/AuthProvider'
import { accountMessage, codeDigits } from '../lib/accountErrors'
import { api, ApiError } from '../lib/api'
import { CodeInput } from './AccountScreens'
import { DangerButton, FormError, Modal, SecondaryButton } from './Modal'
import { Field } from './ui'

/** The API's 409 when the account still owns servers (block 4.2.2). */
type OwnedServers = { code: 'owns_servers'; servers: { id: string; name: string }[] }

function ownedServers(err: unknown): OwnedServers['servers'] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null
  const detail = err.detail as Partial<OwnedServers> | undefined
  return detail?.code === 'owns_servers' && Array.isArray(detail.servers) ? detail.servers : null
}

/** Editar perfil › Conta: "Desativar ou excluir conta", with what each one does. */
export function DeleteAccountSettings(): ReactNode {
  const { t } = useTranslation()
  const [open, setOpen] = useState<'deactivate' | 'delete' | null>(null)
  return (
    <section className="space-y-4">
      <h3 className="font-display text-base font-semibold">{t('account.close.title')}</h3>
      <div className="rounded-control border border-line bg-main p-4">
        <p className="font-medium">{t('account.close.deactivate')}</p>
        <p className="mt-1 text-sm text-fg-muted">
          {t('account.close.deactivateHint')}
        </p>
        <div className="mt-3">
          <SecondaryButton type="button" onClick={() => setOpen('deactivate')}>
            {t('account.close.deactivateAccount')}
          </SecondaryButton>
        </div>
      </div>
      <div className="rounded-control border border-danger/40 bg-main p-4">
        <p className="font-medium text-danger">{t('account.close.delete')}</p>
        <p className="mt-1 text-sm text-fg-muted">
          {t('account.close.deleteHint')}
        </p>
        <div className="mt-3">
          <DangerButton type="button" onClick={() => setOpen('delete')}>
            {t('account.close.deleteAccount')}
          </DangerButton>
        </div>
      </div>
      {open === 'deactivate' && <DeactivateModal onClose={() => setOpen(null)} />}
      {open === 'delete' && <DeleteModal onClose={() => setOpen(null)} />}
    </section>
  )
}

function DeactivateModal({ onClose }: { onClose(): void }): ReactNode {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!password) return setError(t('account.close.typePassword'))
    setBusy(true)
    setError(null)
    try {
      await api('/users/me/deactivate', { method: 'POST', body: { password } })
      // Every session ended on the server; this one too.
      await logout()
    } catch (err) {
      setError(accountMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={t('account.close.deactivateAccount')} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <p className="text-sm text-fg-muted">
          {t('account.close.deactivateModal')}
        </p>
        <FormError message={error} />
        <Field label={t('auth.password')} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <SecondaryButton type="button" onClick={onClose}>
            {t('common.cancel')}
          </SecondaryButton>
          <DangerButton type="submit" disabled={busy}>
            {busy ? t('auth.wait') : t('account.close.deactivate')}
          </DangerButton>
        </div>
      </form>
    </Modal>
  )
}

function DeleteModal({ onClose }: { onClose(): void }): ReactNode {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [deleteMessages, setDeleteMessages] = useState(false)
  const [servers, setServers] = useState<OwnedServers['servers'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      const owned = ownedServers(err)
      if (owned) setServers(owned)
      else setError(accountMessage(err))
    }
    setBusy(false)
  }

  const sendCode = (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!password) return Promise.resolve(setError(t('account.close.typePassword')))
    return run(async () => {
      await api('/users/me/deletion/code', { method: 'POST', body: { password } })
      setStep('code')
    })
  }

  const confirm = (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (codeDigits(code).length !== 6) return Promise.resolve(setError(t('account.verify.codeDigits')))
    return run(async () => {
      await api('/users/me/deletion', { method: 'POST', body: { password, code: codeDigits(code), delete_messages: deleteMessages } })
      await logout()
    })
  }

  return (
    <Modal title={t('account.close.deleteAccount')} onClose={onClose}>
      {servers ? (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            {t('account.close.owner')}
          </p>
          <ul className="list-inside list-disc text-sm">
            {servers.map((s) => (
              <li key={s.id}>{s.name}</li>
            ))}
          </ul>
          <SecondaryButton type="button" onClick={onClose}>
            {t('account.close.gotIt')}
          </SecondaryButton>
        </div>
      ) : step === 'password' ? (
        <form className="space-y-4" onSubmit={sendCode} noValidate>
          <p className="text-sm text-fg-muted">{t('account.close.confirmPassword')}</p>
          <FormError message={error} />
          <Field label={t('auth.password')} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <SecondaryButton type="button" onClick={onClose}>
              {t('common.cancel')}
            </SecondaryButton>
            <DangerButton type="submit" disabled={busy}>
              {busy ? t('auth.wait') : t('account.close.sendCode')}
            </DangerButton>
          </div>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={confirm} noValidate>
          <p className="text-sm text-fg-muted">{t('account.close.typeCode')}</p>
          <FormError message={error} />
          <CodeInput value={code} onChange={setCode} autoFocus />
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={deleteMessages} onChange={(e) => setDeleteMessages(e.target.checked)} className="mt-0.5 accent-accent" />
            <span>
              <span className="font-medium">{t('account.close.deleteMessages')}</span>
              <span className="block text-fg-muted">
                {t('account.close.deleteMessagesHint')}
              </span>
            </span>
          </label>
          <p className="text-sm text-fg-muted">{t('account.close.grace')}</p>
          <div className="grid grid-cols-2 gap-3">
            <SecondaryButton type="button" onClick={onClose}>
              {t('common.cancel')}
            </SecondaryButton>
            <DangerButton type="submit" disabled={busy}>
              {busy ? t('auth.wait') : t('account.close.deleteAccount')}
            </DangerButton>
          </div>
        </form>
      )}
    </Modal>
  )
}
