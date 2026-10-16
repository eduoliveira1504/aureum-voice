import { Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { mediaUrl } from '../lib/api'
import { useChat } from '../store/chat'
import { AddServerModal } from './modals'

function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}

export function ServerBar(): ReactNode {
  const servers = useChat((s) => s.servers)
  const order = useChat((s) => s.order)
  const selectedId = useChat((s) => s.selectedServerId)
  const selectServer = useChat((s) => s.selectServer)
  const [adding, setAdding] = useState(false)

  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail py-3">
      {order.map((id) => {
        const server = servers[id]
        if (!server) return null
        const active = id === selectedId
        return (
          <button
            key={id}
            type="button"
            title={server.name}
            aria-current={active ? 'page' : undefined}
            onClick={() => selectServer(id)}
            className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-control font-display text-sm font-semibold ring-offset-2 ring-offset-rail transition-all ${
              active ? 'bg-accent text-on-accent ring-2 ring-accent' : 'bg-elevated text-fg hover:ring-2 hover:ring-line'
            }`}
          >
            {server.icon_url ? <img src={mediaUrl(server.icon_url)} alt="" className="h-full w-full object-cover" /> : initials(server.name)}
          </button>
        )
      })}

      {order.length > 0 && <div className="h-0.5 w-8 shrink-0 rounded bg-line" />}

      <button
        type="button"
        title="Adicionar um servidor"
        onClick={() => setAdding(true)}
        aria-label="Adicionar um servidor"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control border border-dashed border-line text-accent-text transition-colors hover:border-accent hover:bg-accent hover:text-on-accent"
      >
        <Plus size={22} />
      </button>

      {adding && <AddServerModal onClose={() => setAdding(false)} />}
    </nav>
  )
}
