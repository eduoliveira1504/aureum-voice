/**
 * Every text of the app, one JSON file per area and language (block 4.2.6). pt-BR is the source:
 * the English files must have the same keys (the compiler checks the missing ones, resources.test
 * the extra ones and the {{placeholders}}). All areas go in one namespace, so a key reads
 * `area.thing` (t('chat.composer.placeholder')).
 */

import enAccount from './locales/en/account.json'
import enAddons from './locales/en/addons.json'
import enAuth from './locales/en/auth.json'
import enBugs from './locales/en/bugs.json'
import enCall from './locales/en/call.json'
import enChat from './locales/en/chat.json'
import enCommon from './locales/en/common.json'
import enErrors from './locales/en/errors.json'
import enHome from './locales/en/home.json'
import enMedia from './locales/en/media.json'
import enNav from './locales/en/nav.json'
import enOverlay from './locales/en/overlay.json'
import enPeople from './locales/en/people.json'
import enPermissions from './locales/en/permissions.json'
import enProfile from './locales/en/profile.json'
import enServer from './locales/en/server.json'
import enSettings from './locales/en/settings.json'
import enShell from './locales/en/shell.json'
import enSounds from './locales/en/sounds.json'
import enSystem from './locales/en/system.json'
import enTop from './locales/en/top.json'
import enTour from './locales/en/tour.json'
import ptAccount from './locales/pt-BR/account.json'
import ptAddons from './locales/pt-BR/addons.json'
import ptAuth from './locales/pt-BR/auth.json'
import ptBugs from './locales/pt-BR/bugs.json'
import ptCall from './locales/pt-BR/call.json'
import ptChat from './locales/pt-BR/chat.json'
import ptCommon from './locales/pt-BR/common.json'
import ptErrors from './locales/pt-BR/errors.json'
import ptHome from './locales/pt-BR/home.json'
import ptMedia from './locales/pt-BR/media.json'
import ptNav from './locales/pt-BR/nav.json'
import ptOverlay from './locales/pt-BR/overlay.json'
import ptPeople from './locales/pt-BR/people.json'
import ptPermissions from './locales/pt-BR/permissions.json'
import ptProfile from './locales/pt-BR/profile.json'
import ptServer from './locales/pt-BR/server.json'
import ptSettings from './locales/pt-BR/settings.json'
import ptShell from './locales/pt-BR/shell.json'
import ptSounds from './locales/pt-BR/sounds.json'
import ptSystem from './locales/pt-BR/system.json'
import ptTop from './locales/pt-BR/top.json'
import ptTour from './locales/pt-BR/tour.json'

export const ptBR = {
  common: ptCommon,
  settings: ptSettings,
  system: ptSystem,
  errors: ptErrors,
  auth: ptAuth,
  account: ptAccount,
  profile: ptProfile,
  bugs: ptBugs,
  overlay: ptOverlay,
  call: ptCall,
  chat: ptChat,
  media: ptMedia,
  permissions: ptPermissions,
  server: ptServer,
  sounds: ptSounds,
  nav: ptNav,
  top: ptTop,
  people: ptPeople,
  home: ptHome,
  tour: ptTour,
  shell: ptShell,
  addons: ptAddons
}

export const en: typeof ptBR = {
  common: enCommon,
  settings: enSettings,
  system: enSystem,
  errors: enErrors,
  auth: enAuth,
  account: enAccount,
  profile: enProfile,
  bugs: enBugs,
  overlay: enOverlay,
  call: enCall,
  chat: enChat,
  media: enMedia,
  permissions: enPermissions,
  server: enServer,
  sounds: enSounds,
  nav: enNav,
  top: enTop,
  people: enPeople,
  home: enHome,
  tour: enTour,
  shell: enShell,
  addons: enAddons
}

export const resources = {
  'pt-BR': { translation: ptBR },
  en: { translation: en }
} as const
