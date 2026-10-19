/**
 * The app's last log lines, kept in memory only, so a bug report can carry them. Collects the
 * main process' console and the app window's console. Lines are redacted as they arrive
 * (tokens, e-mails), so nothing sensitive is ever held, and nothing is written to disk.
 */
import { format } from 'node:util'

import type { WebContents } from 'electron'

import { redact } from '../shared/redact'

const MAX_LINES = 300
const MAX_LINE_LENGTH = 500

const lines: string[] = []

function push(source: string, level: string, text: string): void {
  const clipped = text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text
  lines.push(`${new Date().toISOString()} [${source}] ${level}: ${redact(clipped)}`)
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
}

/** Copies the main process' console output into the buffer (it still prints as before). */
export function captureMainConsole(): void {
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      push('main', level, format(...args))
      original(...args)
    }
  }
}

/** Copies a window's console messages into the buffer (verbose ones are skipped). */
export function captureWindowConsole(contents: WebContents, source: string): void {
  contents.on('console-message', (event) => {
    if (event.level !== 'debug') push(source, event.level, event.message)
  })
  contents.on('render-process-gone', (_, details) => push(source, 'error', `renderer gone: ${details.reason}`))
}

export function recentLogs(): string {
  return lines.join('\n')
}
