/**
 * Disk cache for attachments already downloaded, so scrolling back or reopening a conversation
 * doesn't fetch them again. Files are named by attachment id (they never change), kept under
 * userData/attachment-cache up to MAX_BYTES (least recently used go first), and wiped on logout.
 */

import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app } from 'electron'

const MAX_BYTES = 500 * 1024 * 1024
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const dir = (): string => join(app.getPath('userData'), 'attachment-cache')

function pathOf(id: unknown): string {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid attachment id')
  return join(dir(), id)
}

export async function get(id: unknown): Promise<Uint8Array | null> {
  const path = pathOf(id)
  try {
    const data = await readFile(path)
    const now = new Date()
    void utimes(path, now, now).catch(() => {}) // marks it recently used
    return data
  } catch {
    return null
  }
}

let pruning: Promise<void> | null = null

export async function put(id: unknown, data: unknown): Promise<void> {
  const path = pathOf(id)
  if (!(data instanceof Uint8Array) || data.byteLength > MAX_BYTES / 4) return
  await mkdir(dir(), { recursive: true })
  await writeFile(path, data)
  pruning ??= prune().finally(() => (pruning = null))
}

async function prune(): Promise<void> {
  const files = await Promise.all(
    (await readdir(dir())).map(async (name) => {
      const info = await stat(join(dir(), name)).catch(() => null)
      return { name, size: info?.size ?? 0, used: info?.mtimeMs ?? 0 }
    })
  )
  let total = files.reduce((n, f) => n + f.size, 0)
  for (const file of files.sort((a, b) => a.used - b.used)) {
    if (total <= MAX_BYTES) break
    await rm(join(dir(), file.name), { force: true })
    total -= file.size
  }
}

export async function clear(): Promise<void> {
  await rm(dir(), { recursive: true, force: true })
}
