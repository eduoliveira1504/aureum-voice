import { Presentation } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { fetchMedia, type User } from '../../lib/api'
import { thumbnailUrl, type BoardSummary } from './store'
import { dateFormat } from '../../lib/format'
import { t } from '../../lib/i18n'

// Picture URLs change with every new picture, so a fetched one never goes stale.
const pictures = new Map<string, Promise<string>>()

function picture(url: string): Promise<string> {
  let pending = pictures.get(url)
  if (!pending) {
    pending = fetchMedia(url).then((blob) => URL.createObjectURL(blob))
    pending.catch(() => pictures.delete(url))
    pictures.set(url, pending)
  }
  return pending
}

/** The board's picture (rendered by the app that last edited it), or an icon until there's one. */
export function BoardThumbnail({ channelId, board, className = '' }: { channelId: string; board: BoardSummary; className?: string }): ReactNode {
  const url = thumbnailUrl(channelId, board)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (url) void picture(url).then((s) => alive && setSrc(s), () => alive && setSrc(null))
    else setSrc(null)
    return () => {
      alive = false
    }
  }, [url])
  return (
    <span className={`flex items-center justify-center overflow-hidden bg-elevated ${className}`}>
      {src ? (
        <img src={src} alt="" className="wb-picture h-full w-full object-contain" />
      ) : (
        <Presentation size={28} className="text-fg-subtle" />
      )}
    </span>
  )
}

const SHORT_DATE = { day: '2-digit', month: '2-digit' } as const

/** "editado por Ana há 5 min" */
export function editedLabel(board: BoardSummary, people: Map<string, User>, now = Date.now()): string {
  const who = (board.updated_by && people.get(board.updated_by)?.display_name) || t('addons.whiteboard.someoneLower')
  const minutes = Math.max(0, Math.floor((now - new Date(board.updated_at).getTime()) / 60_000))
  let when: string
  if (minutes < 1) when = t('addons.whiteboard.edited.justNow')
  else if (minutes < 60) when = t('addons.whiteboard.edited.minutes', { count: minutes })
  else if (minutes < 24 * 60) when = t('addons.whiteboard.edited.hours', { count: Math.floor(minutes / 60) })
  else if (minutes < 48 * 60) when = t('addons.whiteboard.edited.yesterday')
  else when = t('addons.whiteboard.edited.on', { date: dateFormat(SHORT_DATE).format(new Date(board.updated_at)) })
  return t('addons.whiteboard.edited.by', { who, when })
}
