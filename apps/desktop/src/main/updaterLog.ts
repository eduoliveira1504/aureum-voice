/**
 * The updater's log, kept in a file in the app's data folder (logs/updater.log), so a PC where
 * updates don't arrive can tell why: "Reportar problema" sends its last lines. Lines are redacted
 * (tokens, e-mails, the account name in folder paths). The file is small: past MAX_BYTES it
 * becomes updater.old.log and a new one starts.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { redact } from '../shared/redact'

export const MAX_BYTES = 256 * 1024
const MAX_LINE_LENGTH = 500

let file: string | null = null

/** Where the log goes (the app's data folder); until then nothing is written. */
export function initUpdaterLog(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'updater.log')
  } catch {
    file = null // no log rather than no app
  }
}

export function logUpdater(level: 'info' | 'warn' | 'error', message: string): void {
  if (!file) return
  const clipped = message.length > MAX_LINE_LENGTH ? `${message.slice(0, MAX_LINE_LENGTH)}…` : message
  const line = `${new Date().toISOString()} ${level}: ${redact(clipped.replace(/\s+/g, ' '))}\n`
  try {
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) {
      renameSync(file, join(file, '..', 'updater.old.log'))
    }
    appendFileSync(file, line)
  } catch {
    // A full disk or a locked file must never break the app.
  }
}

/** The last lines, for bug reports. */
export function updaterLogTail(lines = 80): string {
  if (!file) return ''
  try {
    return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n')
  } catch {
    return ''
  }
}
