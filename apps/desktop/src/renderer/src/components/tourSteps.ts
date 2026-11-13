import { shortcut } from '../lib/platform'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import type { TourStep } from './Tour'
import { t } from '../lib/i18n'

/**
 * The first tour (block 3.16), on the Aureum's own layout. The guide is the official logo.
 * New steps get `since` = the new TOUR_VERSION (lib/onboarding.ts); anchors.test.ts checks that
 * every anchor below exists in the app.
 */

/** The official server if the person is in it (owned by @aureum), else their first server. */
export function tourServer(): string | null {
  const { servers, order } = useChat.getState()
  const list = order.map((id) => servers[id]).filter((s) => !!s)
  const official = list.find((s) => s.members.find((m) => m.user.id === s.owner_id)?.user.is_official)
  return (official ?? list[0])?.id ?? null
}

/** Opens the tour's server with the overview showing in the first panel. */
function openTourServer(): void {
  const id = tourServer()
  if (!id) return
  const nav = useNav.getState()
  if (nav.place !== id) nav.openServer(id)
  nav.activateTab(id, 0, 'overview')
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    since: 1,
    get title() {
      return t('tour.steps.welcome.title')
    },
    get text() {
      return t('tour.steps.welcome.text')
    },
    get next() {
      return t('tour.start')
    }
  },
  {
    id: 'tabs',
    since: 1,
    anchor: 'abas',
    get title() {
      return t('tour.steps.tabs.title')
    },
    get text() {
      return t('tour.steps.tabs.text')
    }
  },
  {
    id: 'home',
    since: 1,
    anchor: 'inicio',
    get title() {
      return t('tour.steps.home.title')
    },
    get text() {
      return t('tour.steps.home.text')
    },
    prepare: () => useNav.getState().openHome('hub')
  },
  {
    id: 'sidebar',
    since: 1,
    needsServer: true,
    anchor: 'sidebar',
    get title() {
      return t('tour.steps.sidebar.title')
    },
    get text() {
      return t('tour.steps.sidebar.text')
    },
    prepare: openTourServer
  },
  {
    id: 'overview',
    since: 1,
    needsServer: true,
    anchor: 'visao-geral',
    get title() {
      return t('tour.steps.overview.title')
    },
    get text() {
      return t('tour.steps.overview.text')
    },
    prepare: openTourServer
  },
  {
    id: 'panels',
    since: 1,
    needsServer: true,
    anchor: 'paineis',
    get title() {
      return t('tour.steps.panels.title')
    },
    get text() {
      return t('tour.steps.panels.text')
    },
    prepare: openTourServer
  },
  {
    id: 'members',
    since: 1,
    needsServer: true,
    anchor: 'membros',
    get title() {
      return t('tour.steps.members.title')
    },
    get text() {
      return t('tour.steps.members.text', { key: shortcut('Ctrl+Shift+U') })
    },
    prepare: openTourServer
  },
  {
    id: 'addons',
    since: 1,
    needsServer: true,
    anchor: 'addons',
    centerIfMissing: true,
    get title() {
      return t('tour.steps.addons.title')
    },
    get text() {
      return t('tour.steps.addons.text')
    },
    prepare: openTourServer
  },
  {
    id: 'profile',
    since: 1,
    anchor: 'perfil',
    get title() {
      return t('tour.steps.profile.title')
    },
    get text() {
      return t('tour.steps.profile.text', { key: shortcut('Ctrl+Shift+R') })
    }
  },
  {
    id: 'bell',
    since: 1,
    anchor: 'sino',
    get title() {
      return t('tour.steps.bell.title')
    },
    get text() {
      return t('tour.steps.bell.text')
    }
  },
  {
    id: 'done',
    since: 1,
    get title() {
      return t('tour.steps.done.title')
    },
    get text() {
      return t('tour.steps.done.text')
    },
    get next() {
      return t('tour.finish')
    }
  }
]
