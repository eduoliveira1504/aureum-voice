/**
 * What the loading screen (block 3.23) shows and when it gives way to the app. Kept free of
 * Electron so it can be tested with fake timers: index.ts feeds it the updater's phases and the
 * main window's "ready", and gets back the status line, "open the app" or "install the update".
 *
 * - The screen stays on screen at least MIN_MS (no flash; counted from when it appears) and at
 *   most MAX_MS from the start; past that the app opens anyway
 *   (it already copes with the API being down).
 * - The update check gets CHECK_LIMIT_MS; still checking after that, the app opens and the updater
 *   carries on in the background, as before.
 * - While an update is downloading, each bit of progress allows STALL_MS more, up to
 *   DOWNLOAD_MAX_MS from the start; a stalled or slow download lets the app open and keeps going in
 *   the background ("Reiniciar para atualizar" when it's done).
 */

export const MIN_MS = 1200
export const MAX_MS = 10_000
export const CHECK_LIMIT_MS = 5000
export const STALL_MS = 10_000
export const DOWNLOAD_MAX_MS = 90_000

export const TEXT = {
  checking: 'Procurando atualizações…',
  downloading: (percent: number) => `Baixando atualização (${Math.floor(percent)}%)…`,
  connecting: 'Conectando…',
  opening: 'Abrindo o Aureum…',
  offline: 'Sem conexão, abrindo mesmo assim…'
} as const

export type UpdatePhase =
  | { kind: 'checking' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded' }
  /** Nothing new, or not looking (development). */
  | { kind: 'none' }
  | { kind: 'failed'; offline: boolean }

/** Chromium's network errors that mean "no internet here" (not "GitHub had a problem"). */
const OFFLINE = /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|NETWORK_CHANGED|NETWORK_ACCESS_DENIED|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED)|ENOTFOUND|EAI_AGAIN|ENETUNREACH/

export function isOfflineError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${(err as { code?: unknown }).code ?? ''}` : String(err)
  return OFFLINE.test(text)
}

export interface StartupHooks {
  status(text: string): void
  /** Fade the loading screen out and show the main window. */
  open(): void
  /** Restart into the downloaded version. */
  install(): void
}

export interface Startup {
  update(phase: UpdatePhase): void
  /** The loading screen is on screen: the minimum time counts from here. */
  shown(): void
  /** The main window has the session restored (or knows it can't); online = it reached the API. */
  appReady(online: boolean): void
  /** True once the app opened or the update is installing: later news is ignored. */
  readonly done: boolean
}

export function createStartup(hooks: StartupHooks, { checkUpdates }: { checkUpdates: boolean }): Startup {
  const start = Date.now()
  // The app waits for the screen to appear, then stays behind it for the minimum time.
  let shownAt: number | null = null
  let done = false
  let updateSettled = !checkUpdates
  let downloading = false
  let ready = false
  let offline = false
  let lastText = ''
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let deadline: ReturnType<typeof setTimeout> | null = null

  const later = (ms: number, fn: () => void): ReturnType<typeof setTimeout> => {
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
    return t
  }
  const say = (text: string): void => {
    if (done || text === lastText) return
    lastText = text
    hooks.status(text)
  }
  const finish = (then: () => void): void => {
    if (done) return
    done = true
    for (const t of timers) clearTimeout(t)
    timers.clear()
    then()
  }
  const open = (): void =>
    finish(() => {
      if (!offline) hooks.status(TEXT.opening)
      hooks.open()
    })
  /** Opens once the app is ready and the update question is settled, never before MIN_MS. */
  const tryOpen = (): void => {
    if (done || !ready || !updateSettled || shownAt === null) return
    const wait = MIN_MS - (Date.now() - shownAt)
    if (wait > 0) later(wait, open)
    else open()
  }
  const setDeadline = (atFromStart: number): void => {
    if (deadline) {
      clearTimeout(deadline)
      timers.delete(deadline)
    }
    deadline = later(Math.max(0, atFromStart - (Date.now() - start)), open)
  }
  const settleUpdate = (): void => {
    updateSettled = true
    downloading = false
    if (!offline) say(TEXT.connecting)
    tryOpen()
  }

  say(checkUpdates ? TEXT.checking : TEXT.connecting)
  setDeadline(MAX_MS)
  if (checkUpdates) {
    later(CHECK_LIMIT_MS, () => {
      if (!updateSettled && !downloading) settleUpdate()
    })
  }

  return {
    get done() {
      return done
    },
    shown() {
      if (shownAt === null && !done) {
        shownAt = Date.now()
        tryOpen()
      }
    },
    update(phase) {
      if (done || (updateSettled && phase.kind !== 'downloaded')) return
      switch (phase.kind) {
        case 'checking':
          return
        case 'downloading':
          downloading = true
          say(TEXT.downloading(phase.percent))
          // Keep the screen while it moves, within the overall limit.
          setDeadline(Math.min(Date.now() - start + STALL_MS, DOWNLOAD_MAX_MS))
          return
        case 'downloaded':
          // Finished after the app opened: the window's "Reiniciar para atualizar" takes over.
          return finish(hooks.install)
        case 'none':
          return settleUpdate()
        case 'failed':
          if (phase.offline) {
            offline = true
            say(TEXT.offline)
          }
          return settleUpdate()
      }
    },
    appReady(online) {
      if (done || ready) return
      ready = true
      if (!online) {
        offline = true
        say(TEXT.offline)
      }
      tryOpen()
    }
  }
}
