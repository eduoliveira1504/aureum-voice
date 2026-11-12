import { useState, type FormEvent, type ReactNode } from 'react'

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
  const [open, setOpen] = useState<'deactivate' | 'delete' | null>(null)
  return (
    <section className="space-y-4">
      <h3 className="font-display text-base font-semibold">Desativar ou excluir conta</h3>
      <div className="rounded-control border border-line bg-main p-4">
        <p className="font-medium">Desativar</p>
        <p className="mt-1 text-sm text-fg-muted">
          Sua conta some para os outros: o perfil fica escondido e você sai da lista de amigos de todo mundo. Suas
          mensagens, servidores e amizades ficam guardados. Para voltar, é só entrar de novo com seu e-mail e senha.
        </p>
        <div className="mt-3">
          <SecondaryButton type="button" onClick={() => setOpen('deactivate')}>
            Desativar conta
          </SecondaryButton>
        </div>
      </div>
      <div className="rounded-control border border-danger/40 bg-main p-4">
        <p className="font-medium text-danger">Excluir</p>
        <p className="mt-1 text-sm text-fg-muted">
          A conta fica desativada por 30 dias e depois é apagada de vez: perfil, fotos, amizades e convites. Nesse prazo,
          entrar de novo deixa você cancelar. Se você é dono de algum servidor, passe a posse antes. Suas mensagens ficam
          com o autor &quot;Usuário excluído&quot;, a não ser que você peça para apagá-las também.
        </p>
        <div className="mt-3">
          <DangerButton type="button" onClick={() => setOpen('delete')}>
            Excluir conta
          </DangerButton>
        </div>
      </div>
      {open === 'deactivate' && <DeactivateModal onClose={() => setOpen(null)} />}
      {open === 'delete' && <DeleteModal onClose={() => setOpen(null)} />}
    </section>
  )
}

function DeactivateModal({ onClose }: { onClose(): void }): ReactNode {
  const { logout } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!password) return setError('Digite sua senha.')
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
    <Modal title="Desativar conta" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <p className="text-sm text-fg-muted">
          Você sai da conta em todos os aparelhos. Para reativar, é só entrar de novo com seu e-mail e senha.
        </p>
        <FormError message={error} />
        <Field label="Senha" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <SecondaryButton type="button" onClick={onClose}>
            Cancelar
          </SecondaryButton>
          <DangerButton type="submit" disabled={busy}>
            {busy ? 'Aguarde…' : 'Desativar'}
          </DangerButton>
        </div>
      </form>
    </Modal>
  )
}

function DeleteModal({ onClose }: { onClose(): void }): ReactNode {
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
    if (!password) return Promise.resolve(setError('Digite sua senha.'))
    return run(async () => {
      await api('/users/me/deletion/code', { method: 'POST', body: { password } })
      setStep('code')
    })
  }

  const confirm = (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (codeDigits(code).length !== 6) return Promise.resolve(setError('Digite os 6 números do código.'))
    return run(async () => {
      await api('/users/me/deletion', { method: 'POST', body: { password, code: codeDigits(code), delete_messages: deleteMessages } })
      await logout()
    })
  }

  return (
    <Modal title="Excluir conta" onClose={onClose}>
      {servers ? (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            Você ainda é dono destes servidores. Passe a posse para alguém (Configurações do servidor › Membros) ou exclua
            o servidor, e depois volte aqui.
          </p>
          <ul className="list-inside list-disc text-sm">
            {servers.map((s) => (
              <li key={s.id}>{s.name}</li>
            ))}
          </ul>
          <SecondaryButton type="button" onClick={onClose}>
            Entendi
          </SecondaryButton>
        </div>
      ) : step === 'password' ? (
        <form className="space-y-4" onSubmit={sendCode} noValidate>
          <p className="text-sm text-fg-muted">Confirme sua senha. Depois, mandamos um código de 6 números para o seu e-mail.</p>
          <FormError message={error} />
          <Field label="Senha" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <SecondaryButton type="button" onClick={onClose}>
              Cancelar
            </SecondaryButton>
            <DangerButton type="submit" disabled={busy}>
              {busy ? 'Aguarde…' : 'Enviar código'}
            </DangerButton>
          </div>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={confirm} noValidate>
          <p className="text-sm text-fg-muted">Digite o código que chegou no seu e-mail.</p>
          <FormError message={error} />
          <CodeInput value={code} onChange={setCode} autoFocus />
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={deleteMessages} onChange={(e) => setDeleteMessages(e.target.checked)} className="mt-0.5 accent-accent" />
            <span>
              <span className="font-medium">Apagar também minhas mensagens</span>
              <span className="block text-fg-muted">
                Em canais, conversas e grupos, junto com os arquivos. Desmarcado, elas ficam com o autor &quot;Usuário excluído&quot;.
              </span>
            </span>
          </label>
          <p className="text-sm text-fg-muted">A conta fica desativada agora e é apagada em 30 dias. Até lá, entrar de novo deixa você cancelar.</p>
          <div className="grid grid-cols-2 gap-3">
            <SecondaryButton type="button" onClick={onClose}>
              Cancelar
            </SecondaryButton>
            <DangerButton type="submit" disabled={busy}>
              {busy ? 'Aguarde…' : 'Excluir conta'}
            </DangerButton>
          </div>
        </form>
      )}
    </Modal>
  )
}
