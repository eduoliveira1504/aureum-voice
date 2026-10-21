import { type ReactNode } from 'react'

import type { Me } from '../lib/api'

/** "Bom dia" from 5h, "Boa tarde" from 12h, "Boa noite" from 18h, by the PC's clock. */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return 'Bom dia'
  if (hour >= 12 && hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

/** Home's hub: what matters right now, across servers, conversations and addons. */
export function HomeHub({ me }: { me: Me }): ReactNode {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-8 py-7">
        <header>
          <h1 className="font-display text-3xl font-bold">
            {greeting()}, {me.display_name}
          </h1>
        </header>
      </div>
    </div>
  )
}
