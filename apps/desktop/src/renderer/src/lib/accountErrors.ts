import type { ParseKeys } from 'i18next'

import { ApiError, getApiBaseUrl } from './api'
import { t } from './i18n'

/** The API's details for account flows, in the app's words. */
const MESSAGES: Record<string, ParseKeys> = {
  'An invite code is required to sign up': 'errors.api.inviteRequired',
  'Invalid invite code': 'errors.api.inviteInvalid',
  'This invite was already used': 'errors.api.inviteUsed',
  'This invite has no spots left': 'errors.api.inviteFull',
  'This invite has expired': 'errors.api.inviteExpired',
  'Wrong code': 'errors.api.wrongCode',
  'This code has expired; ask for a new one': 'errors.api.codeExpired',
  'Too many wrong tries; ask for a new code': 'errors.api.codeTooManyTries',
  'Wait a moment before asking for another code': 'errors.api.codeWait',
  'This e-mail is already confirmed': 'errors.api.emailConfirmed',
  'This email is already taken': 'errors.api.emailTaken',
  'That is already your e-mail': 'errors.api.sameEmail',
  'Wrong password': 'errors.api.wrongPassword',
  'The new password must be different': 'errors.api.samePassword',
  'Confirm your e-mail to create servers': 'errors.api.confirmToCreateServers'
}

/** The server's own message when it's out of service on purpose (503 with a detail written for
 * people, e.g. "O Aureum mudou de servidor. Atualize o app."), else null. */
export function serverNotice(err: unknown): string | null {
  return err instanceof ApiError && err.status === 503 && typeof err.detail === 'string' && err.detail
    ? err.detail
    : null
}

export function accountMessage(err: unknown): string {
  const notice = serverNotice(err)
  if (notice) return notice
  if (err instanceof ApiError) {
    if (err.status === 429 && !MESSAGES[String(err.detail)]) return t('errors.tooManyTries')
    if (typeof err.detail === 'string' && MESSAGES[err.detail]) return t(MESSAGES[err.detail])
    if (err.status === 422) return t('errors.invalidFields')
    return t('errors.unexpected', { status: err.status })
  }
  return t('errors.unreachable', { url: getApiBaseUrl() })
}

/** Accepts the 6 digits with spaces or dashes, as people paste them. */
export function codeDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}
