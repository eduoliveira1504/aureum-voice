/** Block 4.1.4: the updater's log is kept in a small file that bug reports can carry. */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { initUpdaterLog, logUpdater, MAX_BYTES, updaterLogTail } from './updaterLog'

let dir: string

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'aureum-updater-')), 'logs')
  initUpdaterLog(dir)
})
afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

describe('updater log', () => {
  it('writes each step to logs/updater.log', () => {
    logUpdater('info', 'checking (installed 0.2.0-beta.10)')
    logUpdater('error', 'failed (offline): net::ERR_INTERNET_DISCONNECTED')
    const text = readFileSync(join(dir, 'updater.log'), 'utf8')
    expect(text).toMatch(/^\S+ info: checking \(installed 0.2.0-beta.10\)\n\S+ error: failed \(offline\)/)
    expect(updaterLogTail()).toContain('ERR_INTERNET_DISCONNECTED')
  })

  it('keeps nothing personal: tokens, e-mails, the account name in paths', () => {
    logUpdater('error', 'Cannot write C:\\Users\\Eduardo\\AppData\\Local\\aureum-voice-updater\\pending for ana@mail.com')
    const tail = updaterLogTail()
    expect(tail).toContain('C:\\Users\\[user]\\AppData')
    expect(tail).not.toContain('Eduardo')
    expect(tail).not.toContain('ana@mail.com')
  })

  it('stays small: a full file is set aside and a new one starts', () => {
    writeFileSync(join(dir, 'updater.log'), 'x'.repeat(MAX_BYTES + 1))
    logUpdater('info', 'up to date')
    expect(existsSync(join(dir, 'updater.old.log'))).toBe(true)
    expect(updaterLogTail().trim().split('\n')).toHaveLength(1)
  })

  it('bug reports get only the last lines', () => {
    for (let i = 0; i < 200; i++) logUpdater('info', `line ${i}`)
    const tail = updaterLogTail(80).split('\n')
    expect(tail).toHaveLength(80)
    expect(tail.at(-1)).toContain('line 199')
  })
})
