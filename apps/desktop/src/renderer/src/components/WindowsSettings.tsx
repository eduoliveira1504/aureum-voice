import { useEffect, useState, type ReactNode } from 'react'

import type { AppSettings } from '../../../shared/types'
import { labelClass, Segmented, ToggleRow } from './ui'

/** How the app behaves on this PC: what the X does and starting with Windows. Kept on this PC. */
export function WindowsSettings(): ReactNode {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    window.aureum.settings.get().then(setSettings, () => setError(true))
  }, [])

  function update(patch: Partial<AppSettings>): void {
    if (settings) setSettings({ ...settings, ...patch })
    window.aureum.settings.set(patch).then(setSettings, () => setError(true))
  }

  if (!settings) return error ? <p className="text-sm text-danger">Não foi possível carregar as configurações.</p> : null
  return (
    <div className="space-y-5">
      <div>
        <span className={labelClass}>Ao fechar a janela</span>
        <Segmented
          options={[
            { value: 'tray', label: 'Minimizar para a bandeja' },
            { value: 'quit', label: 'Sair' }
          ]}
          value={settings.closeToTray ? 'tray' : 'quit'}
          onChange={(v) => update({ closeToTray: v === 'tray' })}
        />
        <p className="mt-1.5 text-xs text-fg-subtle">
          Na bandeja, o Aureum continua conectado: chamadas, mensagens e notificações seguem chegando. Para fechar de vez, use{' '}
          <b>Sair do Aureum</b> no ícone da bandeja.
        </p>
      </div>
      <ToggleRow
        title="Iniciar com o Windows"
        description="Abre minimizado na bandeja quando você liga o PC (só no app instalado)."
        checked={settings.openAtLogin}
        onChange={(openAtLogin) => update({ openAtLogin })}
      />
      {error && <p className="text-sm text-danger">Não foi possível salvar.</p>}
    </div>
  )
}
