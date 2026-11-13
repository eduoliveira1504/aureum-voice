import { useEffect, useState, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import type { AppSettings } from '../../../shared/types'
import { isMac } from '../lib/platform'
import { labelClass, Segmented, ToggleRow } from './ui'

/** How the app behaves on this PC: what the X does and starting with Windows (window or tray).
 * Kept on this PC. On the Mac ("Mac" tab): the same, with the menu bar in place of the tray, and
 * no "start in the tray" (macOS doesn't tell the app it was opened at login). */
export function WindowsSettings(): ReactNode {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    window.aureum.settings.get().then(setSettings, () => setError(true))
  }, [])

  function update(patch: Partial<AppSettings>): void {
    if (settings) setSettings({ ...settings, ...patch })
    window.aureum.settings.set(patch).then(setSettings, () => setError(true))
  }

  if (!settings) return error ? <p className="text-sm text-danger">{t('common.loadFailed')}</p> : null
  if (isMac()) {
    return (
      <div className="space-y-5">
        <div>
          <span className={labelClass}>{t('settings.windows.onClose')}</span>
          <Segmented
            options={[
              { value: 'tray', label: t('settings.windows.keepOpen') },
              { value: 'quit', label: t('settings.windows.quit') }
            ]}
            value={settings.closeToTray ? 'tray' : 'quit'}
            onChange={(v) => update({ closeToTray: v === 'tray' })}
          />
          <p className="mt-1.5 text-xs text-fg-subtle">
            <Trans i18nKey="settings.windows.macOpenHint" components={{ b: <b /> }} />
          </p>
        </div>
        <ToggleRow
          title={t('settings.windows.macLogin')}
          description={t('settings.windows.macLoginHint')}
          checked={settings.openAtLogin}
          onChange={(openAtLogin) => update({ openAtLogin })}
        />
        {error && <p className="text-sm text-danger">{t('common.saveFailed')}</p>}
      </div>
    )
  }
  return (
    <div className="space-y-5">
      <div>
        <span className={labelClass}>{t('settings.windows.onClose')}</span>
        <Segmented
          options={[
            { value: 'tray', label: t('settings.windows.toTray') },
            { value: 'quit', label: t('settings.windows.quit') }
          ]}
          value={settings.closeToTray ? 'tray' : 'quit'}
          onChange={(v) => update({ closeToTray: v === 'tray' })}
        />
        <p className="mt-1.5 text-xs text-fg-subtle">
          <Trans i18nKey="settings.windows.trayHint" components={{ b: <b /> }} />
        </p>
      </div>
      <ToggleRow
        title={t('settings.windows.login')}
        description={t('settings.windows.loginHint')}
        checked={settings.openAtLogin}
        onChange={(openAtLogin) => update({ openAtLogin })}
      />
      {settings.openAtLogin && (
        <div>
          <span className={labelClass}>{t('settings.windows.onStartup')}</span>
          <Segmented
            options={[
              { value: 'window', label: t('settings.windows.openWindow') },
              { value: 'tray', label: t('settings.windows.startInTray') }
            ]}
            value={settings.loginStart}
            onChange={(loginStart) => update({ loginStart })}
          />
          <p className="mt-1.5 text-xs text-fg-subtle">
            {settings.loginStart === 'window'
              ? t('settings.windows.windowHint')
              : t('settings.windows.trayStartHint')}
          </p>
        </div>
      )}
      {error && <p className="text-sm text-danger">{t('common.saveFailed')}</p>}
    </div>
  )
}
