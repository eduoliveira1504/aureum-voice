import { useEffect, useMemo, type ReactNode } from 'react'

import { serverPeople } from '../../lib/members'
import type { AddonViewProps } from '../types'
import { BoardThumbnail, editedLabel } from './bits'
import { useWhiteboard } from './store'

/** The channel's card on the server overview: the board edited last, with its picture. */
export function WhiteboardSummary({ server, channel }: AddonViewProps): ReactNode {
  const list = useWhiteboard((s) => s.lists[channel.id])
  const people = useMemo(() => serverPeople(server), [server])
  useEffect(() => {
    if (!useWhiteboard.getState().lists[channel.id]) void useWhiteboard.getState().load(channel.id).catch(() => {})
  }, [channel.id])

  if (!list) return <span className="text-sm text-fg-subtle">Carregando…</span>
  // Newest first already.
  const last = list.boards.find((b) => !b.archived_at)
  if (!last) return <span className="text-sm text-fg-subtle">Nenhum quadro ainda.</span>
  return (
    <span className="flex items-center gap-3">
      <BoardThumbnail channelId={channel.id} board={last} className="h-16 w-24 shrink-0 rounded-item border border-line" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{last.name}</span>
        <span className="block truncate text-xs text-fg-subtle">{editedLabel(last, people)}</span>
      </span>
    </span>
  )
}
