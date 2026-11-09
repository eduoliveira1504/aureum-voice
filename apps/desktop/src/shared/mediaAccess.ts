/** macOS privacy permissions the app depends on (block 3.21, see main/mediaAccess.ts). */

export type MediaKind = 'microphone' | 'camera' | 'screen'
/** What macOS answers (systemPreferences.getMediaAccessStatus). */
export type MediaAccess = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export const isMediaKind = (value: unknown): value is MediaKind =>
  value === 'microphone' || value === 'camera' || value === 'screen'

/**
 * Whether to go ahead. Screen recording "not-determined" goes ahead: listing the screens is what
 * makes macOS ask. "unknown" too (an older macOS without the answer): the capture itself then
 * fails with the usual error.
 */
export const mayProceed = (kind: MediaKind, access: MediaAccess): boolean =>
  access === 'granted' || access === 'unknown' || (kind === 'screen' && access === 'not-determined')

/** The notice shown when a permission is off, in plain words. */
export const ACCESS_TEXT: Record<MediaKind, { title: string; body: string }> = {
  microphone: {
    title: 'O Aureum não tem acesso ao microfone',
    body: 'Para falar nas salas e chamadas, libere o Aureum Voice em Ajustes do Sistema › Privacidade e Segurança › Microfone.'
  },
  camera: {
    title: 'O Aureum não tem acesso à câmera',
    body: 'Para ligar o vídeo, libere o Aureum Voice em Ajustes do Sistema › Privacidade e Segurança › Câmera.'
  },
  screen: {
    title: 'O Aureum não pode gravar a tela',
    body:
      'Para transmitir sua tela, libere o Aureum Voice em Ajustes do Sistema › Privacidade e Segurança › ' +
      'Gravação de Tela e Áudio do Sistema. Depois feche o Aureum (Cmd+Q) e abra de novo: o macOS só aplica ' +
      'essa permissão quando o app reabre.'
  }
}
