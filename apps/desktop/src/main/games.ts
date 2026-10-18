/**
 * "Jogando X": finds known games among the programs with an open window on this PC.
 *
 * The process list never leaves the main process except to the user's own window (to pick a
 * game by hand); the renderer only forwards the detected game's name to the server.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app } from 'electron'

import type { GamePrefs, KnownGame, RunningApp } from '../shared/types'
import bundledGames from './games.json'

const POLL_MS = 20_000
const MAX_CUSTOM = 50
const MAX_NAME = 64

const DEFAULT_PREFS: GamePrefs = { enabled: true, custom: [], hidden: [], manual: null }

// Lists processes that have a main window: games always do, background services don't.
// Output is forced to UTF-8 so accented window titles survive.
const LIST_WINDOWS =
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Process | Where-Object MainWindowTitle | Select-Object ProcessName,MainWindowTitle | ConvertTo-Json -Compress'

const prefsPath = (): string => join(app.getPath('userData'), 'games.json')

let prefs: GamePrefs | null = null
let current: string | null = null
let timer: NodeJS.Timeout | null = null
let notify: (game: string | null) => void = () => {}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

const cleanName = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : ''

function cleanGame(value: unknown): KnownGame | null {
  if (!value || typeof value !== 'object') return null
  const { name, exe } = value as Partial<KnownGame>
  const exes = (Array.isArray(exe) ? exe : [exe])
    .map((e) => (typeof e === 'string' ? e.trim() : ''))
    .filter((e) => /^[^\\/:*?"<>|]{1,128}\.exe$/i.test(e))
  const clean = cleanName(name)
  return clean && exes.length ? { name: clean, exe: exes.slice(0, 5) } : null
}

function cleanPrefs(raw: Partial<GamePrefs>, base: GamePrefs): GamePrefs {
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    custom: Array.isArray(raw.custom)
      ? raw.custom.map(cleanGame).filter((g): g is KnownGame => g !== null).slice(0, MAX_CUSTOM)
      : base.custom,
    hidden: Array.isArray(raw.hidden)
      ? [...new Set(raw.hidden.map(cleanName).filter(Boolean))].slice(0, 200)
      : base.hidden,
    manual: raw.manual === null ? null : raw.manual !== undefined ? cleanName(raw.manual) || null : base.manual
  }
}

export async function getPrefs(): Promise<GamePrefs> {
  if (prefs) return prefs
  try {
    prefs = cleanPrefs(JSON.parse(await readFile(prefsPath(), 'utf8')), DEFAULT_PREFS)
  } catch {
    prefs = { ...DEFAULT_PREFS }
  }
  return prefs
}

export async function setPrefs(patch: Partial<GamePrefs>): Promise<GamePrefs> {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid preferences')
  prefs = cleanPrefs(patch, await getPrefs())
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(prefsPath(), JSON.stringify(prefs, null, 2))
  schedule()
  void detect()
  return prefs
}

export async function knownGames(): Promise<KnownGame[]> {
  return [...(await getPrefs()).custom, ...(bundledGames as KnownGame[])]
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function runningApps(): Promise<RunningApp[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', LIST_WINDOWS],
      { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout.trim()) return resolve([])
        try {
          const parsed: unknown = JSON.parse(stdout)
          // ConvertTo-Json returns a bare object when there's a single result.
          const rows = (Array.isArray(parsed) ? parsed : [parsed]) as { ProcessName?: unknown; MainWindowTitle?: unknown }[]
          resolve(
            rows
              .filter((r) => typeof r.ProcessName === 'string')
              .map((r) => ({ exe: `${r.ProcessName}.exe`, title: String(r.MainWindowTitle ?? '') }))
          )
        } catch {
          resolve([])
        }
      }
    )
  })
}

function matches(game: KnownGame, apps: RunningApp[]): boolean {
  const exes = new Set(game.exe.map((e) => e.toLowerCase()))
  let title: RegExp | null = null
  if (game.title) {
    try {
      title = new RegExp(game.title, 'i')
    } catch {
      return false
    }
  }
  return apps.some((a) => exes.has(a.exe.toLowerCase()) && (!title || title.test(a.title)))
}

async function detect(): Promise<void> {
  const { enabled, hidden } = await getPrefs()
  let found: string | null = null
  if (enabled) {
    const apps = await runningApps()
    const candidates = (await knownGames()).filter((g) => !hidden.includes(g.name) && matches(g, apps))
    // Keep showing the same game while it's still open, even if another one starts.
    found = candidates.find((g) => g.name === current)?.name ?? candidates[0]?.name ?? null
  }
  if (found !== current) {
    current = found
    notify(found)
  }
}

function schedule(): void {
  if (timer) clearInterval(timer)
  timer = null
  if (prefs?.enabled) timer = setInterval(() => void detect(), POLL_MS)
}

export function currentGame(): string | null {
  return current
}

/** Starts polling; `onChange` gets the detected game's name whenever it changes. */
export async function startGameDetection(onChange: (game: string | null) => void): Promise<void> {
  notify = onChange
  await getPrefs()
  schedule()
  await detect()
}
