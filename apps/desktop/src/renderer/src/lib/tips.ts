/**
 * First-time tips (block 3.16): one balloon the first time something happens; "Entendi" closes it
 * for good (saved in user_settings.onboarding.tips_seen, so the key is what's remembered: never
 * rename one). `anchor` is the data-tour of the element it points at; anchors.test.ts checks that
 * it exists in the app.
 */

import { t } from './i18n'
export interface TipDef {
  anchor: string
  title: string
  text: string
}

/** A tip whose title and text are read in the app's language when shown. */
const tip = (key: string, anchor: string): TipDef => ({
  anchor,
  get title() {
    return t(`tour.tips.${key}.title` as never)
  },
  get text() {
    return t(`tour.tips.${key}.text` as never)
  }
})

export const TIPS = {
  'call.controls': tip('call.controls', 'call-controles'),
  'call.soundboard': tip('call.soundboard', 'painel-sons'),
  'call.overlay': tip('call.overlay', 'call-controles'),
  'screen.watch': tip('screen.watch', 'assistir'),
  'screen.watching': tip('screen.watching', 'tela-assistida'),
  'screen.share': tip('screen.share', 'modo-tela'),
  'server.owner': tip('server.owner', 'menu-servidor'),
  'addon.kanban': tip('addon.kanban', 'addon'),
  'addon.whiteboard': tip('addon.whiteboard', 'addon'),
  'addon.events': tip('addon.events', 'addon'),
  'addon.calendar': tip('addon.calendar', 'addon'),
  'chat.polls': tip('chat.polls', 'chat-mais'),
  'chat.reactions': tip('chat.reactions', 'reacoes'),
  'dm.receipts': tip('dm.receipts', 'conversa'),
  'dm.official': tip('dm.official', 'conversa'),
  'people.menu': tip('people.menu', 'menu-contexto'),
  'ptt.key': tip('ptt.key', 'ptt-tecla')
} satisfies Record<string, TipDef>

/** The tip of each addon's panel, by addon key. */
export const ADDON_TIPS: Partial<Record<string, TipKey>> = {
  kanban: 'addon.kanban',
  whiteboard: 'addon.whiteboard',
  events: 'addon.events',
  calendar: 'addon.calendar'
}

export type TipKey = keyof typeof TIPS
