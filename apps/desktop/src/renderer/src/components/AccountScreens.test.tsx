/**
 * Block 2.10's screens: confirming the e-mail, replacing a temporary password, changing the
 * e-mail, the invites list and "esqueci minha senha".
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../lib/api'
import type { Confirmation, Me, MyInvite } from '../lib/api'
import { AuthScreen } from '../screens/AuthScreen'
import { ForcePasswordScreen, VerifyEmailScreen } from './AccountScreens'
import { AccountSettings, InvitesSettings } from './AccountSettings'

const auth = vi.hoisted(() => ({
  setUser: vi.fn(),
  logout: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
  login: vi.fn(async () => {}),
  register: vi.fn(async () => {})
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'signedOut' }, ...auth })
}))

const ME: Me = {
  id: 'u-1',
  username: 'mari',
  display_name: 'Mari',
  avatar_url: null,
  banner_url: null,
  bio: null,
  accent_color: null,
  pronouns: null,
  custom_status: null,
  avatar_frame: 'none',
  favorite_song: null,
  links: [],
  badges: [],
  created_at: new Date().toISOString(),
  email: 'mari@exemplo.com',
  is_app_owner: false,
  email_verified: false,
  must_change_password: false
}

const typeInto = (label: RegExp | string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  vi.restoreAllMocks()
  for (const fn of Object.values(auth)) fn.mockClear()
})

describe('confirming the e-mail', () => {
  it('takes the code (pasted with spaces) and shows the Pioneiro number and invites', async () => {
    const result: Confirmation = {
      user: { ...ME, email_verified: true, badges: [{ key: 'pioneer', number: 7, granted_at: ME.created_at }] },
      pioneer_number: 7,
      invites: 3,
      joined_official: true
    }
    const verify = vi.spyOn(api, 'verifyEmail').mockResolvedValue(result)
    render(<VerifyEmailScreen user={ME} onLater={() => {}} />)

    typeInto('Código de 6 dígitos', '482 913')
    expect((screen.getByLabelText('Código de 6 dígitos') as HTMLInputElement).value).toBe('482913')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await screen.findByText('Tudo pronto, @mari.')
    expect(verify).toHaveBeenCalledWith('482913')
    expect(screen.getByText('nº 07')).toBeTruthy()
    expect(screen.getByText('Você já está no servidor do beta.')).toBeTruthy()
    expect(screen.getByText('3 convites')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Entrar no Aureum' }))
    expect(auth.setUser).toHaveBeenCalledWith(result.user)
  })

  it('explains a wrong code and waits a minute before resending', async () => {
    vi.spyOn(api, 'verifyEmail').mockRejectedValue(new api.ApiError(400, 'Wrong code'))
    render(<VerifyEmailScreen user={ME} onLater={() => {}} />)
    expect((screen.getByRole('button', { name: /reenviar em 0:/ }) as HTMLButtonElement).disabled).toBe(true)
    typeInto('Código de 6 dígitos', '111111')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Código errado. Confira o e-mail e tente de novo.')
  })

  it('resends at once when reopened later, and fixes a mistyped address', async () => {
    const resend = vi.spyOn(api, 'resendCode').mockResolvedValue()
    const fixed = vi.spyOn(api, 'changePendingEmail').mockResolvedValue({ ...ME, email: 'mari.certo@exemplo.com' })
    render(<VerifyEmailScreen user={{ ...ME, created_at: '2026-01-01T00:00:00Z' }} onLater={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'reenviar código' }))
    await waitFor(() => expect(resend).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Trocar e-mail' }))
    typeInto(/E-mail certo/, 'mari.certo@exemplo.com')
    fireEvent.click(screen.getByRole('button', { name: 'Mandar o código' }))
    await screen.findByText('mari.certo@exemplo.com')
    expect(fixed).toHaveBeenCalledWith('mari.certo@exemplo.com')
  })

  it('"Agora não" goes into the app', () => {
    const later = vi.fn()
    render(<VerifyEmailScreen user={ME} onLater={later} />)
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(later).toHaveBeenCalled()
  })
})

describe('temporary password', () => {
  it('asks for a new one, which must match, and can still sign out', async () => {
    const change = vi.spyOn(api, 'changePassword').mockResolvedValue()
    render(<ForcePasswordScreen />)

    typeInto(/Senha nova/, 'nova-senha-1')
    typeInto(/Repita a senha/, 'outra-coisa')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }))
    expect((await screen.findByRole('alert')).textContent).toBe('As senhas não coincidem.')

    typeInto(/Repita a senha/, 'nova-senha-1')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }))
    await waitFor(() => expect(auth.reload).toHaveBeenCalled())
    expect(change).toHaveBeenCalledWith('nova-senha-1')

    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(auth.logout).toHaveBeenCalled()
  })
})

describe('Configurações › Conta', () => {
  it('changes the e-mail only after the code from the new address', async () => {
    const request = vi.spyOn(api, 'requestEmailChange').mockResolvedValue()
    const confirm = vi.spyOn(api, 'confirmEmailChange').mockResolvedValue({ ...ME, email: 'novo@exemplo.com' })
    render(<AccountSettings user={{ ...ME, email_verified: true }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Trocar e-mail' }))
    typeInto(/E-mail novo/, 'novo@exemplo.com')
    typeInto(/Sua senha/, 'minha-senha')
    fireEvent.click(screen.getByRole('button', { name: 'Mandar código pro e-mail novo' }))
    await screen.findByLabelText('Código de 6 dígitos')
    expect(request).toHaveBeenCalledWith('novo@exemplo.com', 'minha-senha')

    typeInto('Código de 6 dígitos', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e-mail novo' }))
    await screen.findByText('E-mail trocado. Avisamos o endereço antigo.')
    expect(confirm).toHaveBeenCalledWith('123456')
    expect(auth.setUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'novo@exemplo.com' }))
  })

  it('changes the password with the current one', async () => {
    const change = vi.spyOn(api, 'changePassword').mockRejectedValueOnce(new api.ApiError(403, 'Wrong password'))
    render(<AccountSettings user={{ ...ME, email_verified: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }))
    typeInto(/Senha atual/, 'errada')
    typeInto(/^Senha nova/, 'nova-senha-1')
    typeInto(/Repita a senha nova/, 'nova-senha-1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Trocar senha' }).at(-1)!)
    expect((await screen.findByRole('alert')).textContent).toBe('Senha atual incorreta.')
    expect(change).toHaveBeenCalledWith('nova-senha-1', 'errada')
  })
})

describe('Configurações › Convites', () => {
  const invites: MyInvite[] = [
    { code: 'AB12CD34', url: 'https://aureum.test/convite/AB12CD34', status: 'used', used_by: { username: 'ana', display_name: 'Ana', avatar_url: null } },
    { code: 'EF56GH78', url: 'https://aureum.test/convite/EF56GH78', status: 'pending', used_by: { username: 'bia', display_name: 'Bia', avatar_url: null } },
    { code: 'JK9MN234', url: 'https://aureum.test/convite/JK9MN234', status: 'free', used_by: null }
  ]

  it('lists each invite with its status and copies the free ones', async () => {
    vi.spyOn(api, 'myInvites').mockResolvedValue(invites)
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(<InvitesSettings user={{ ...ME, email_verified: true }} />)

    await screen.findByText('JK9MN234')
    expect(screen.getByText('Usado · @ana')).toBeTruthy()
    expect(screen.getByText('Aguardando confirmação · @bia')).toBeTruthy()
    expect(screen.getByText('Livre')).toBeTruthy()
    const copyButtons = screen.getAllByRole('button', { name: /Copiar link/ })
    expect(copyButtons).toHaveLength(1)
    await act(async () => fireEvent.click(copyButtons[0]))
    expect(writeText).toHaveBeenCalledWith('https://aureum.test/convite/JK9MN234')
    expect(screen.getByText('Copiado')).toBeTruthy()
  })

  it('has none before confirming, nor for official accounts', () => {
    const list = vi.spyOn(api, 'myInvites')
    const { unmount } = render(<InvitesSettings user={ME} />)
    expect(screen.getByText('Confirme seu e-mail pra ganhar seus convites.')).toBeTruthy()
    unmount()
    render(<InvitesSettings user={{ ...ME, email_verified: true, is_official: true }} />)
    expect(screen.getByText('Contas oficiais não têm convites.')).toBeTruthy()
    expect(list).not.toHaveBeenCalled()
  })
})

describe('sign-in screen', () => {
  it('hides the invite field when sign-up is open', async () => {
    vi.spyOn(api, 'authConfig').mockResolvedValue({ invite_only: false })
    render(<AuthScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Registre-se' }))
    await waitFor(() => expect(screen.queryByLabelText(/Convite/)).toBeNull())
  })

  it('shows the invite field while invite-only', async () => {
    vi.spyOn(api, 'authConfig').mockResolvedValue({ invite_only: true })
    render(<AuthScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Registre-se' }))
    expect(await screen.findByLabelText(/Convite/)).toBeTruthy()
  })

  it('resets a forgotten password with the e-mailed code', async () => {
    vi.spyOn(api, 'authConfig').mockResolvedValue({ invite_only: true })
    const forgot = vi.spyOn(api, 'forgotPassword').mockResolvedValue()
    const reset = vi.spyOn(api, 'resetPassword').mockResolvedValue()
    render(<AuthScreen />)

    fireEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }))
    typeInto(/E-mail/, 'mari@exemplo.com')
    fireEvent.click(screen.getByRole('button', { name: 'Mandar código' }))
    await screen.findByLabelText('Código de 6 dígitos')
    expect(forgot).toHaveBeenCalledWith('mari@exemplo.com')

    typeInto('Código de 6 dígitos', '654321')
    typeInto(/^Senha nova/, 'nova-senha-1')
    typeInto(/Repita a senha/, 'nova-senha-1')
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha e entrar' }))
    await waitFor(() => expect(auth.reload).toHaveBeenCalled())
    expect(reset).toHaveBeenCalledWith('mari@exemplo.com', '654321', 'nova-senha-1')
  })
})
