import { CaptureUpdateAction, exportToBlob, reconcileElements, restoreElements } from '@excalidraw/excalidraw'
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type {
  AppState,
  BinaryFiles,
  Collaborator,
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
  OnUserFollowedPayload,
  SocketId
} from '@excalidraw/excalidraw/types'

import { api, ApiError, fetchMedia, mediaUrl, uploadFile, type User } from '../../lib/api'
import { sendRealtime, type ServerEvent } from '../../lib/realtime'
import { whiteboardPath, type BoardScene, type SceneElement } from './store'
import { blobToDataUrl, dataUrlToBlob, followView, markKnown, takeChanged, type Viewport } from './sync'

/** Saving: after a pause this long, and at least this often while drawing nonstop. */
const SAVE_DELAY = 1000
const SAVE_MAX_WAIT = 4000
const SAVE_RETRY = 5000
const SAVE_BATCH = 1000
/** Strokes go live this often while they're drawn, in batches of at most LIVE_BATCH. */
const LIVE_EVERY = 80
const LIVE_BATCH = 200
const POINTER_EVERY = 50
/** Cursors are sent again this often when idle; one not heard from for PEER_TIMEOUT goes. */
const HEARTBEAT = 5000
const PEER_TIMEOUT = 15_000
/** The list's picture of the board is redrawn at most this often. */
const THUMBNAIL_EVERY = 30_000
const THUMBNAIL_SIZE = 480
/** An image someone else just placed may still be uploading. */
const FILE_RETRIES = 5
const FILE_RETRY_DELAY = 2000

export type SyncStatus = 'saved' | 'saving' | 'offline' | 'full' | 'image-failed'

interface Peer {
  collaborator: Collaborator
  viewport?: Viewport
  seen: number
}

interface Pointer {
  x: number
  y: number
  tool: 'pointer' | 'laser'
  button: 'up' | 'down'
}

interface Options {
  channelId: string
  board: BoardScene
  canEdit: boolean
  /** The server's people, for names, pictures and colors of cursors. */
  people(): Map<string, User>
  onStatus(status: SyncStatus): void
}

/**
 * Keeps an open board in sync. Changes go two ways: live over the WebSocket while they're
 * drawn (others see the stroke grow), and saved over HTTP a second later (what lasts). An
 * element is sent when its version goes past the last one sent or received; incoming ones are
 * merged with Excalidraw's own reconcile, so the newer copy of each element wins everywhere.
 */
export class BoardSync {
  /** Tells this app's own changes apart when they come back from a save. */
  readonly origin = crypto.randomUUID()
  private excalidraw: ExcalidrawImperativeAPI | null = null
  private readonly known = new Map<string, number>()
  private readonly pendingSave = new Map<string, SceneElement>()
  private readonly pendingLive = new Map<string, SceneElement>()
  private readonly uploaded = new Set<string>()
  private readonly fetching = new Set<string>()
  private readonly peers = new Map<string, Peer>()
  private following: string | null = null
  private pointer: Pointer | null = null
  private saving = false
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private saveDeadline = 0
  private liveTimer: ReturnType<typeof setTimeout> | undefined
  private pointerTimer: ReturnType<typeof setTimeout> | undefined
  private thumbnailTimer: ReturnType<typeof setTimeout> | undefined
  private lastThumbnail = 0
  private thumbnailDirty = false
  private readonly intervals: ReturnType<typeof setInterval>[] = []
  private disposed = false

  constructor(private readonly o: Options) {
    markKnown(o.board.elements, this.known)
  }

  private path(path: string): string {
    return whiteboardPath(this.o.channelId, path)
  }

  attach(excalidraw: ExcalidrawImperativeAPI): void {
    if (this.excalidraw || this.disposed) return
    this.excalidraw = excalidraw
    this.join()
    void this.loadFiles(this.o.board.elements)
    this.intervals.push(
      setInterval(() => this.sendPointer(), HEARTBEAT),
      setInterval(() => this.prunePeers(), HEARTBEAT)
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.intervals.forEach(clearInterval)
    clearTimeout(this.liveTimer)
    clearTimeout(this.pointerTimer)
    clearTimeout(this.saveTimer)
    clearTimeout(this.thumbnailTimer)
    this.flushLive()
    void this.flushSave().then(() => (this.thumbnailDirty ? this.uploadThumbnail() : undefined))
    sendRealtime('addon.whiteboard.join', { channel_id: this.o.channelId, board_id: null })
  }

  private join(): void {
    sendRealtime('addon.whiteboard.join', { channel_id: this.o.channelId, board_id: this.o.board.id, origin: this.origin })
  }

  // --- Local changes ------------------------------------------------------------

  onChange(elements: readonly OrderedExcalidrawElement[], files: BinaryFiles): void {
    if (!this.o.canEdit || this.disposed) return
    const changed = takeChanged(elements, this.known) as unknown as SceneElement[]
    if (!changed.length) return
    for (const element of changed) {
      this.pendingSave.set(element.id, element)
      this.pendingLive.set(element.id, element)
    }
    this.thumbnailDirty = true
    this.liveTimer ??= setTimeout(() => this.flushLive(), LIVE_EVERY)
    this.scheduleSave(SAVE_DELAY)
    this.uploadFiles(changed, files)
  }

  private flushLive(): void {
    this.liveTimer = undefined
    const elements = [...this.pendingLive.values()]
    this.pendingLive.clear()
    for (let i = 0; i < elements.length; i += LIVE_BATCH) {
      // Offline: dropped, the save brings everyone up to date.
      sendRealtime('addon.whiteboard.update', { board_id: this.o.board.id, elements: elements.slice(i, i + LIVE_BATCH), origin: this.origin })
    }
  }

  private scheduleSave(delay: number): void {
    const now = Date.now()
    if (!this.saveDeadline) this.saveDeadline = now + SAVE_MAX_WAIT
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flushSave(), Math.max(0, Math.min(delay, this.saveDeadline - now)))
  }

  private async flushSave(): Promise<void> {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    if (this.saving || !this.pendingSave.size) return
    this.saveDeadline = 0
    this.saving = true
    const batch = [...this.pendingSave.values()]
    this.pendingSave.clear()
    this.o.onStatus('saving')
    let retry = false
    try {
      for (let i = 0; i < batch.length; i += SAVE_BATCH) {
        await api(this.path(`/boards/${this.o.board.id}/elements`), {
          method: 'PUT',
          body: { elements: batch.slice(i, i + SAVE_BATCH), origin: this.origin }
        })
      }
      this.o.onStatus('saved')
      this.scheduleThumbnail()
    } catch (err) {
      // Put back what wasn't saved, unless it changed again meanwhile.
      for (const element of batch) if (!this.pendingSave.has(element.id)) this.pendingSave.set(element.id, element)
      const full = err instanceof ApiError && err.status === 413
      this.o.onStatus(full ? 'full' : 'offline')
      retry = !full
    } finally {
      this.saving = false
    }
    if (this.disposed) return
    if (retry) this.scheduleSave(SAVE_RETRY)
    else if (this.pendingSave.size) this.scheduleSave(SAVE_DELAY)
  }

  private uploadFiles(changed: SceneElement[], files: BinaryFiles): void {
    for (const element of changed) {
      const fileId = element.fileId
      if (element.type !== 'image' || !fileId || this.uploaded.has(fileId)) continue
      const file = files[fileId as keyof BinaryFiles]
      if (!file) continue
      this.uploaded.add(fileId)
      uploadFile(this.path('/files'), dataUrlToBlob(file.dataURL), 'imagem', () => {}, { file_id: fileId }).done.catch(() => {
        this.uploaded.delete(fileId)
        this.o.onStatus('image-failed')
      })
    }
  }

  // --- Thumbnail ----------------------------------------------------------------

  private scheduleThumbnail(): void {
    if (!this.o.canEdit || !this.thumbnailDirty || this.thumbnailTimer || this.disposed) return
    const wait = Math.max(0, this.lastThumbnail + THUMBNAIL_EVERY - Date.now())
    this.thumbnailTimer = setTimeout(() => void this.uploadThumbnail(), wait)
  }

  private async uploadThumbnail(): Promise<void> {
    this.thumbnailTimer = undefined
    const excalidraw = this.excalidraw
    if (!excalidraw) return
    const elements = excalidraw.getSceneElements()
    if (!elements.length) return
    this.thumbnailDirty = false
    this.lastThumbnail = Date.now()
    try {
      const blob = await exportToBlob({
        elements,
        files: excalidraw.getFiles(),
        // Drawn as in the light theme; the app inverts pictures in the dark one, like Excalidraw.
        appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
        maxWidthOrHeight: THUMBNAIL_SIZE,
        mimeType: 'image/webp',
        quality: 0.8
      })
      const form = new FormData()
      form.append('file', blob, 'quadro.webp')
      await api(this.path(`/boards/${this.o.board.id}/thumbnail`), { method: 'PUT', body: form })
    } catch {
      // Next save tries again.
      this.thumbnailDirty = true
    }
  }

  // --- Changes from others ------------------------------------------------------

  handle({ type, data }: ServerEvent): void {
    if (this.disposed) return
    if (type === 'ready') {
      // Reconnected: back in the room, and catch up on what was missed.
      this.join()
      void api<BoardScene>(this.path(`/boards/${this.o.board.id}`))
        .then((board) => this.applyRemote(board.elements))
        .catch(() => {})
      void this.flushSave()
      return
    }
    if (data?.board_id !== this.o.board.id) return
    switch (type) {
      case 'addon.whiteboard.live':
      case 'addon.whiteboard.elements':
        if (data.origin !== this.origin) this.applyRemote(data.elements as SceneElement[])
        break
      case 'addon.whiteboard.pointer':
        this.updatePeer(data)
        break
      case 'addon.whiteboard.peer.joined':
        // Show up for them right away.
        this.sendPointer()
        break
      case 'addon.whiteboard.peer.left':
        this.dropPeer(data.origin ?? null, data.user_id)
        break
    }
  }

  /** Merges elements from elsewhere (others' strokes, a restored version) into the scene. */
  applyRemote(remote: SceneElement[]): void {
    const excalidraw = this.excalidraw
    if (!excalidraw || !remote.length) return
    markKnown(remote, this.known)
    const restored = restoreElements(remote as unknown as ExcalidrawElement[], null) as unknown as RemoteExcalidrawElement[]
    const merged = reconcileElements(excalidraw.getSceneElementsIncludingDeleted(), restored, excalidraw.getAppState())
    // Not part of this person's undo history.
    excalidraw.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER })
    void this.loadFiles(remote)
  }

  private async loadFiles(elements: readonly SceneElement[]): Promise<void> {
    const excalidraw = this.excalidraw
    if (!excalidraw) return
    const have = excalidraw.getFiles()
    const ids = new Set(
      elements
        .filter((e) => e.type === 'image' && !e.isDeleted && e.fileId && !have[e.fileId as keyof BinaryFiles])
        .map((e) => e.fileId as string)
    )
    await Promise.all([...ids].filter((id) => !this.fetching.has(id)).map((id) => this.loadFile(id)))
  }

  private async loadFile(fileId: string): Promise<void> {
    this.fetching.add(fileId)
    try {
      for (let attempt = 0; attempt < FILE_RETRIES && !this.disposed; attempt++) {
        try {
          const blob = await fetchMedia(`/api${this.path(`/files/${fileId}`)}`)
          const dataURL = await blobToDataUrl(blob)
          this.excalidraw?.addFiles([{ id: fileId as never, dataURL: dataURL as never, mimeType: blob.type as never, created: Date.now() }])
          return
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) return
          await new Promise((resolve) => setTimeout(resolve, FILE_RETRY_DELAY))
        }
      }
    } finally {
      this.fetching.delete(fileId)
    }
  }

  // --- Cursors and following ----------------------------------------------------

  onPointer(pointer: Pointer): void {
    this.pointer = pointer
    this.pointerTimer ??= setTimeout(() => this.sendPointer(), POINTER_EVERY)
  }

  /** The view moved: followers need to know. */
  onScroll(): void {
    this.pointerTimer ??= setTimeout(() => this.sendPointer(), POINTER_EVERY)
  }

  private sendPointer(): void {
    clearTimeout(this.pointerTimer)
    this.pointerTimer = undefined
    const excalidraw = this.excalidraw
    if (!excalidraw || this.disposed) return
    const app = excalidraw.getAppState()
    const viewport: Viewport = { x: app.scrollX, y: app.scrollY, width: app.width, height: app.height, zoom: app.zoom.value }
    // Not pointed anywhere yet: the middle of the view.
    const pointer = this.pointer ?? {
      x: app.width / (2 * viewport.zoom) - app.scrollX,
      y: app.height / (2 * viewport.zoom) - app.scrollY,
      tool: 'pointer',
      button: 'up'
    }
    sendRealtime('addon.whiteboard.pointer', {
      board_id: this.o.board.id,
      ...pointer,
      selected: Object.keys(app.selectedElementIds).slice(0, 100),
      viewport,
      origin: this.origin
    })
  }

  private updatePeer(data: Record<string, any>): void {
    const origin = typeof data.origin === 'string' ? data.origin : data.user_id
    const user = this.o.people().get(data.user_id)
    const color = user?.accent_color ?? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    const collaborator: Collaborator = {
      id: data.user_id,
      socketId: origin as SocketId,
      username: user?.display_name ?? 'Alguém',
      avatarUrl: mediaUrl(user?.avatar_url),
      color: { background: color, stroke: color },
      pointer: { x: data.x, y: data.y, tool: data.tool },
      button: data.button,
      selectedElementIds: Object.fromEntries(((data.selected as string[]) ?? []).map((id) => [id, true]))
    }
    this.peers.set(origin, { collaborator, viewport: data.viewport, seen: Date.now() })
    this.pushPeers()
    if (this.following === origin && data.viewport) this.follow(data.viewport)
  }

  private dropPeer(origin: string | null, userId: string): void {
    const gone = origin ?? [...this.peers.entries()].find(([, p]) => p.collaborator.id === userId)?.[0]
    if (gone && this.peers.delete(gone)) this.pushPeers()
  }

  private prunePeers(): void {
    const cutoff = Date.now() - PEER_TIMEOUT
    let changed = false
    for (const [origin, peer] of this.peers) {
      if (peer.seen < cutoff) changed = this.peers.delete(origin) || changed
    }
    if (changed) this.pushPeers()
  }

  private pushPeers(): void {
    const collaborators = new Map([...this.peers].map(([origin, peer]) => [origin as SocketId, peer.collaborator]))
    this.excalidraw?.updateScene({ collaborators, captureUpdate: CaptureUpdateAction.NEVER })
  }

  /** Excalidraw's "follow" on someone's picture in the people list (and its stop). */
  onUserFollow({ userToFollow, action }: OnUserFollowedPayload): void {
    this.following = action === 'FOLLOW' ? userToFollow.socketId : null
    const viewport = this.following ? this.peers.get(this.following)?.viewport : undefined
    if (viewport) this.follow(viewport)
  }

  private follow(viewport: Viewport): void {
    const excalidraw = this.excalidraw
    if (!excalidraw) return
    const app: AppState = excalidraw.getAppState()
    const view = followView(viewport, app.width, app.height)
    excalidraw.updateScene({
      appState: { scrollX: view.scrollX, scrollY: view.scrollY, zoom: { value: view.zoom as NormalizedZoomValue } },
      captureUpdate: CaptureUpdateAction.NEVER
    })
  }
}
