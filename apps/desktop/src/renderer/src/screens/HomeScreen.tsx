import type { ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { Avatar } from '../components/ui'
import type { Me } from '../lib/api'

/** App shell: server bar | channel list | content | members. Filled in by task 4. */
export function HomeScreen({ user }: { user: Me }): ReactNode {
  return (
    <div className="flex h-full">
      <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-surface-0 py-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-accent-fg">
          A
        </div>
        <div className="h-0.5 w-8 rounded bg-surface-3" />
      </nav>

      <aside className="flex w-60 shrink-0 flex-col bg-surface-1">
        <header className="flex h-12 items-center border-b border-surface-0 px-4 font-semibold shadow-sm">
          Aureum Voice
        </header>
        <div className="flex-1 p-3 text-sm text-fg-subtle">Nenhum servidor ainda.</div>
        <UserPanel user={user} />
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center bg-surface-2 p-8 text-center">
        <h2 className="text-2xl font-semibold">Olá, {user.display_name}!</h2>
        <p className="mt-2 max-w-md text-fg-muted">
          Você está conectado. Servidores, canais e mensagens chegam na próxima etapa.
        </p>
      </main>
    </div>
  )
}

function UserPanel({ user }: { user: Me }): ReactNode {
  const { logout } = useAuth()
  return (
    <div className="flex h-[52px] items-center gap-2 bg-surface-0/60 px-2">
      <Avatar name={user.display_name} url={user.avatar_url} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-semibold">{user.display_name}</div>
        <div className="truncate text-xs text-fg-subtle">@{user.username}</div>
      </div>
      <button
        type="button"
        title="Sair"
        onClick={logout}
        className="rounded px-2 py-1 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg"
      >
        Sair
      </button>
    </div>
  )
}
