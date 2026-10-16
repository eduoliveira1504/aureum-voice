import { useState, type ReactNode } from 'react'

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
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-surface-0 py-3">
      {order.map((id) => {
        const server = servers[id]
        if (!server) return null
        const active = id === selectedId
        return (
          <div key={id} className="group relative flex w-full justify-center">
            <span
              className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r bg-fg transition-all ${active ? 'h-10' : 'h-0 group-hover:h-5'}`}
            />
            <button
              type="button"
              title={server.name}
              onClick={() => selectServer(id)}
              className={`flex h-12 w-12 items-center justify-center overflow-hidden text-sm font-semibold transition-all ${
                active ? 'rounded-2xl bg-accent text-accent-fg' : 'rounded-3xl bg-surface-2 text-fg hover:rounded-2xl hover:bg-accent hover:text-accent-fg'
              }`}
            >
              {server.icon_url ? <img src={server.icon_url} alt="" className="h-full w-full object-cover" /> : initials(server.name)}
            </button>
          </div>
        )
      })}

      {order.length > 0 && <div className="h-0.5 w-8 shrink-0 rounded bg-surface-3" />}

      <button
        type="button"
        title="Adicionar um servidor"
        onClick={() => setAdding(true)}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-3xl bg-surface-2 text-2xl text-green-500 transition-all hover:rounded-2xl hover:bg-green-600 hover:text-white"
      >
        +
      </button>

      {adding && <AddServerModal onClose={() => setAdding(false)} />}
    </nav>
  )
}
