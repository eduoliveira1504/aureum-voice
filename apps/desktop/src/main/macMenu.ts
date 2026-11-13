/**
 * The app menu on macOS (block 3.21): the standard one, in the app's language (rebuilt when it changes). Its Edit menu is what makes
 * Cmd+C/V/X/A/Z work in text fields there. Left out on purpose: Reload and Force Reload (Cmd+R and
 * Cmd+Shift+R, which opens "Reportar problema" instead) and the developer tools.
 */
import { Menu, type MenuItemConstructorOptions } from 'electron'

import { t } from './i18n'

export function installMacMenu(handlers: { reportProblem(): void; quit(): void }): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Aureum Voice',
      submenu: [
        { role: 'about', label: t('system.macMenu.about') },
        { type: 'separator' },
        { label: t('system.macMenu.reportProblem'), accelerator: 'Cmd+Shift+R', click: handlers.reportProblem },
        { type: 'separator' },
        { role: 'hide', label: t('system.macMenu.hide') },
        { role: 'hideOthers', label: t('system.macMenu.hideOthers') },
        { role: 'unhide', label: t('system.macMenu.unhide') },
        { type: 'separator' },
        // Through `quit` so it is a real quit (not just hiding the window), like the menu bar icon.
        { label: t('system.macMenu.quit'), accelerator: 'Cmd+Q', click: handlers.quit }
      ]
    },
    {
      label: t('system.macMenu.edit'),
      submenu: [
        { role: 'undo', label: t('system.macMenu.undo') },
        { role: 'redo', label: t('system.macMenu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('system.macMenu.cut') },
        { role: 'copy', label: t('system.macMenu.copy') },
        { role: 'paste', label: t('system.macMenu.paste') },
        { role: 'pasteAndMatchStyle', label: t('system.macMenu.pasteAndMatchStyle') },
        { role: 'selectAll', label: t('system.macMenu.selectAll') }
      ]
    },
    {
      label: t('system.macMenu.window'),
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: t('system.macMenu.minimize') },
        { role: 'zoom', label: t('system.macMenu.zoom') },
        { role: 'close', label: t('system.macMenu.close') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('system.macMenu.fullScreen') },
        { type: 'separator' },
        { role: 'front', label: t('system.macMenu.front') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
