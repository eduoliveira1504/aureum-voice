import { UserPlus, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'

const FRIEND_TABS = ['Online', 'Todos', 'Pendentes', 'Bloqueados'] as const

/**
 * The Home tab's content: friends and "Active now". A placeholder until block 2.3 brings
 * friendships, DMs and private calls; the structure is already the final one.
 */
export function HomeView(): ReactNode {
  const [tab, setTab] = useState<(typeof FRIEND_TABS)[number]>('Online')
  return (
    <div className="flex min-w-0 flex-1 py-2 pr-2">
      <section aria-label="Amigos" className="flex min-w-0 flex-1 overflow-hidden rounded-panel border border-line bg-main">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
            <Users size={20} className="text-fg-subtle" />
            <h2 className="mr-2 font-semibold">Amigos</h2>
            <div role="tablist" className="flex gap-1">
              {FRIEND_TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`rounded-item px-2.5 py-1 text-sm font-medium ${tab === t ? 'bg-elevated text-fg' : 'text-fg-muted hover:text-fg'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled
              title="Em breve"
              className="ml-auto flex items-center gap-2 rounded-control bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <UserPlus size={16} />
              Adicionar amigo
            </button>
          </header>
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-panel bg-elevated text-accent-text">
              <Users size={32} />
            </div>
            <h3 className="mt-4 text-2xl font-semibold">Amigos chegam em breve</h3>
            <p className="mt-2 max-w-md text-fg-muted">
              Adicione pessoas pelo @username, converse por mensagem direta e ligue sem precisar de um servidor.
            </p>
          </div>
        </div>
        <aside className="hidden w-72 shrink-0 border-l border-line p-5 xl:block">
          <h3 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-fg-subtle">Ativo agora</h3>
          <p className="text-sm text-fg-muted">Quando seus amigos entrarem numa chamada ou jogo, vai aparecer aqui.</p>
        </aside>
      </section>
    </div>
  )
}
