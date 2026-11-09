import { useEffect, useState, type ReactNode } from 'react'

import type { AppSettings } from '../../../shared/types'
import { isMac } from '../lib/platform'
import { labelClass, Segmented, ToggleRow } from './ui'

/** How the app behaves on this PC: what the X does and starting with Windows (window or tray).
 * Kept on this PC. On the Mac ("Mac" tab): the same, with the menu bar in place of the tray, and
 * no "start in the tray" (macOS doesn't tell the app it was opened at login). */
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
  if (isMac()) {
    return (
      <div className="space-y-5">
        <div>
          <span className={labelClass}>Ao fechar a janela</span>
          <Segmented
            options={[
              { value: 'tray', label: 'Continuar aberto' },
              { value: 'quit', label: 'Sair' }
            ]}
            value={settings.closeToTray ? 'tray' : 'quit'}
            onChange={(v) => update({ closeToTray: v === 'tray' })}
          />
          <p className="mt-1.5 text-xs text-fg-subtle">
            Aberto, o Aureum continua conectado: chamadas, mensagens e notificações seguem chegando. Ele fica no Dock e no
            ícone da barra de menus. Para fechar de vez, use <b>Cmd+Q</b>.
          </p>
        </div>
        <ToggleRow
          title="Abrir ao iniciar o Mac"
          description="Abre o Aureum quando você entra na sua conta do Mac."
          checked={settings.openAtLogin}
          onChange={(openAtLogin) => update({ openAtLogin })}
        />
        {error && <p className="text-sm text-danger">Não foi possível salvar.</p>}
      </div>
    )
  }
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
        description="Abre o Aureum quando você liga o PC (só no app instalado)."
        checked={settings.openAtLogin}
        onChange={(openAtLogin) => update({ openAtLogin })}
      />
      {settings.openAtLogin && (
        <div>
          <span className={labelClass}>Ao ligar o PC</span>
          <Segmented
            options={[
              { value: 'window', label: 'Abrir a janela' },
              { value: 'tray', label: 'Iniciar na bandeja' }
            ]}
            value={settings.loginStart}
            onChange={(loginStart) => update({ loginStart })}
          />
          <p className="mt-1.5 text-xs text-fg-subtle">
            {settings.loginStart === 'window'
              ? 'O Aureum abre com a tela de carregamento e já procura atualizações.'
              : 'O Aureum fica só no ícone da bandeja, conectado, até você abrir.'}
          </p>
        </div>
      )}
      {error && <p className="text-sm text-danger">Não foi possível salvar.</p>}
    </div>
  )
}
