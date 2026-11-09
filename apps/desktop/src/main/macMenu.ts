/**
 * The app menu on macOS (block 3.21): the standard one, in pt-BR. Its Edit menu is what makes
 * Cmd+C/V/X/A/Z work in text fields there. Left out on purpose: Reload and Force Reload (Cmd+R and
 * Cmd+Shift+R, which opens "Reportar problema" instead) and the developer tools.
 */
import { Menu, type MenuItemConstructorOptions } from 'electron'

export function installMacMenu(handlers: { reportProblem(): void; quit(): void }): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Aureum Voice',
      submenu: [
        { role: 'about', label: 'Sobre o Aureum Voice' },
        { type: 'separator' },
        { label: 'Reportar problema…', accelerator: 'Cmd+Shift+R', click: handlers.reportProblem },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar Aureum Voice' },
        { role: 'hideOthers', label: 'Ocultar outros' },
        { role: 'unhide', label: 'Mostrar tudo' },
        { type: 'separator' },
        // Through `quit` so it is a real quit (not just hiding the window), like the menu bar icon.
        { label: 'Sair do Aureum Voice', accelerator: 'Cmd+Q', click: handlers.quit }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'pasteAndMatchStyle', label: 'Colar sem formatação' },
        { role: 'selectAll', label: 'Selecionar tudo' }
      ]
    },
    {
      label: 'Janela',
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { role: 'close', label: 'Fechar janela' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        { type: 'separator' },
        { role: 'front', label: 'Trazer tudo para a frente' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
