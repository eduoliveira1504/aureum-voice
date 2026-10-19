import { ApiError, getApiBaseUrl } from './api'

/** The API's details for account flows, in the app's words. */
const MESSAGES: Record<string, string> = {
  'An invite code is required to sign up': 'Você precisa de um código de convite.',
  'Invalid invite code': 'Esse código de convite não existe.',
  'This invite was already used': 'Esse convite já foi usado.',
  'This invite has no spots left': 'As vagas desse convite acabaram.',
  'This invite has expired': 'Esse convite venceu.',
  'Wrong code': 'Código errado. Confira o e-mail e tente de novo.',
  'This code has expired; ask for a new one': 'Esse código venceu. Peça um novo.',
  'Too many wrong tries; ask for a new code': 'Muitas tentativas erradas. Peça um código novo.',
  'Wait a moment before asking for another code': 'Espere um pouquinho antes de pedir outro código.',
  'This e-mail is already confirmed': 'Esse e-mail já está confirmado.',
  'This email is already taken': 'Já existe uma conta com esse e-mail.',
  'That is already your e-mail': 'Esse já é o seu e-mail.',
  'Wrong password': 'Senha atual incorreta.',
  'The new password must be different': 'A senha nova precisa ser diferente da atual.',
  'Confirm your e-mail to create servers': 'Confirme seu e-mail para criar servidores.'
}

export function accountMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429 && !MESSAGES[String(err.detail)]) return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.'
    if (typeof err.detail === 'string' && MESSAGES[err.detail]) return MESSAGES[err.detail]
    if (err.status === 422) return 'Confira os campos: algum valor não é válido.'
    return `Erro inesperado do servidor (${err.status}).`
  }
  return `Não foi possível conectar ao servidor em ${getApiBaseUrl()}.`
}

/** Accepts the 6 digits with spaces or dashes, as people paste them. */
export function codeDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}
