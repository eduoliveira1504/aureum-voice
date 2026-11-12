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
 *   the background (the window's update bar when it's done).
 * - No internet yet (the PC just started and the network is still coming up): the check is tried
 *   again every RETRY_ONLINE_MS until WAIT_ONLINE_MS from the start, "Esperando a conexão…".
 * - `hidden` (a launch by Windows that stays in the tray): nothing shows unless an update starts
 *   downloading; then the screen appears (`reveal`) until it installs. Without one, the app stays
 *   in the tray.
 */

export const MIN_MS = 1200
export const MAX_MS = 15_000
export const CHECK_LIMIT_MS = 10_000
export const STALL_MS = 20_000
// The installer is ~120 MB: on a slow connection that takes minutes, and updating before the app
// opens is the point (block 4.1.4).
export const DOWNLOAD_MAX_MS = 5 * 60_000
export const WAIT_ONLINE_MS = 30_000
export const RETRY_ONLINE_MS = 3000

export const TEXT = {
  checking: 'Procurando atualizações…',
  downloading: (percent: number) => `Baixando atualização (${Math.floor(percent)}%)…`,
  connecting: 'Conectando…',
  waitingOnline: 'Esperando a conexão…',
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

/**
 * Whether this launch stays in the tray, without the loading screen. Windows starts the app with
 * --login (--hidden before block 3.23, still in the registry until the app re-registers): it then
 * follows the "Ao ligar o PC" choice. Opened by hand, the window always shows.
 */
export function startsInTray(argv: readonly string[], loginStart: 'window' | 'tray'): boolean {
  return (argv.includes('--login') || argv.includes('--hidden')) && loginStart === 'tray'
}

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
  /** Check for an update again (the first try found no internet). */
  retry?(): void
  /** `hidden` only: an update is coming, show the loading screen now. */
  reveal?(): void
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

export function createStartup(
  hooks: StartupHooks,
  { checkUpdates, hidden = false }: { checkUpdates: boolean; hidden?: boolean }
): Startup {
  const start = Date.now()
  // The app waits for the screen to appear, then stays behind it for the minimum time. Hidden,
  // there's no screen to wait for.
  let shownAt: number | null = hidden ? start : null
  let revealed = false
  let waitingOnline = false
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
    const wait = hidden ? 0 : MIN_MS - (Date.now() - shownAt)
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
    waitingOnline = false
    if (!offline) say(TEXT.connecting)
    tryOpen()
  }
  /** A check that doesn't answer in time lets the app open (the updater carries on). */
  const limitCheck = (): void => {
    later(CHECK_LIMIT_MS, () => {
      if (!updateSettled && !downloading && !waitingOnline) settleUpdate()
    })
  }

  say(checkUpdates ? TEXT.checking : TEXT.connecting)
  setDeadline(MAX_MS)
  if (checkUpdates) limitCheck()

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
          waitingOnline = false
          if (hidden && !revealed) {
            revealed = true
            hooks.reveal?.()
          }
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
          if (phase.offline && !downloading && hooks.retry && Date.now() - start + RETRY_ONLINE_MS < WAIT_ONLINE_MS) {
            // The network may still be coming up (just after the PC started): wait and ask again.
            waitingOnline = true
            say(TEXT.waitingOnline)
            setDeadline(WAIT_ONLINE_MS + CHECK_LIMIT_MS)
            later(RETRY_ONLINE_MS, () => {
              if (done || updateSettled) return
              waitingOnline = false
              say(TEXT.checking)
              limitCheck()
              hooks.retry?.()
            })
            return
          }
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
      if (!online && !waitingOnline) {
        offline = true
        say(TEXT.offline)
      }
      tryOpen()
    }
  }
}
