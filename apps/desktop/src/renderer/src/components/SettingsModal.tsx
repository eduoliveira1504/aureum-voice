import { Bell, Gamepad2, Mic, Monitor, Palette, UserCog, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../auth/AuthProvider'
import { AboutSettings } from './AboutSettings'
import { AccountSettings, InvitesSettings } from './AccountSettings'
import { ActivitySettings } from './ActivitySettings'
import { AppearanceSettings } from './AppearanceSettings'
import { BugReports } from './BugReports'
import { LanguageSettings } from './LanguageSettings'
import { Modal } from './Modal'
import { NotificationSettings } from './NotificationSettings'
import { OverlaySettings } from './OverlaySettings'
import { PrivacySettings } from './PrivacySettings'
import { SoundSettings } from './SoundSettings'
import { TipsSettings } from './TipsSettings'
import { VoiceSettings } from './VoiceSettings'
import { WindowsSettings } from './WindowsSettings'
import { isMac } from '../lib/platform'

/** The sections, as the tabs were called before they were grouped (callers still open one). */
export type Section =
  | 'account'
  | 'invites'
  | 'activity'
  | 'appearance'
  | 'language'
  | 'voice'
  | 'sounds'
  | 'notifications'
  | 'privacy'
  | 'tips'
  | 'overlay'
  | 'windows'
  | 'reports'
  | 'about'

type Group = 'account' | 'appearance' | 'voice' | 'notifications' | 'games' | 'system'

/** Thirteen tabs didn't fit in a row (Eduardo, 22/11): six groups in a column, each stacking its
 * sections. The order inside a group is the order on screen. */
const GROUPS: { key: Group; icon: LucideIcon; sections: Section[] }[] = [
  { key: 'account', icon: UserCog, sections: ['account', 'privacy', 'invites'] },
  { key: 'appearance', icon: Palette, sections: ['appearance', 'language'] },
  { key: 'voice', icon: Mic, sections: ['voice', 'sounds'] },
  { key: 'notifications', icon: Bell, sections: ['notifications', 'tips'] },
  { key: 'games', icon: Gamepad2, sections: ['activity', 'overlay'] },
  { key: 'system', icon: Monitor, sections: ['windows', 'reports', 'about'] }
]

export const groupOf = (section: Section): Group => GROUPS.find((g) => g.sections.includes(section))?.key ?? 'account'

export function SettingsModal({ onClose, initialTab }: { onClose(): void; initialTab?: Section }): ReactNode {
  const { t } = useTranslation()
  const { state, logout } = useAuth()
  const [group, setGroup] = useState<Group>(() => (initialTab ? groupOf(initialTab) : 'account'))
  const body = useRef<HTMLDivElement>(null)
  const isOwner = state.status === 'signedIn' && state.user.is_app_owner

  // Opened on a section (the call's "Configurações de voz"): scroll to it.
  useEffect(() => {
    if (initialTab) body.current?.querySelector(`[data-section="${initialTab}"]`)?.scrollIntoView?.({ block: 'start' })
  }, [])

  /** What each section shows; null where it doesn't apply (the overlay on the Mac, reports for others). */
  const section = (key: Section): { title: string; content: ReactNode } | null => {
    switch (key) {
      case 'account':
        return state.status === 'signedIn' ? { title: t('profile.edit.account'), content: <AccountSettings user={state.user} /> } : null
      case 'invites':
        return state.status === 'signedIn' ? { title: t('settings.tabs.invites'), content: <InvitesSettings user={state.user} /> } : null
      case 'privacy':
        return { title: t('settings.tabs.privacy'), content: <PrivacySettings /> }
      case 'appearance':
        return { title: t('settings.tabs.appearance'), content: <AppearanceSettings /> }
      case 'language':
        return { title: t('settings.tabs.language'), content: <LanguageSettings /> }
      case 'voice':
        return { title: t('settings.tabs.voice'), content: <VoiceSettings /> }
      case 'sounds':
        return { title: t('settings.tabs.sounds'), content: <SoundSettings /> }
      case 'notifications':
        return { title: t('settings.tabs.notifications'), content: <NotificationSettings /> }
      case 'tips':
        return { title: t('settings.tabs.tips'), content: <TipsSettings onClose={onClose} /> }
      case 'activity':
        return { title: t('settings.tabs.activity'), content: <ActivitySettings /> }
      case 'overlay':
        // The overlay is Windows only.
        return isMac() ? null : { title: t('settings.tabs.overlay'), content: <OverlaySettings /> }
      case 'windows':
        return { title: isMac() ? t('settings.tabs.mac') : t('settings.tabs.windows'), content: <WindowsSettings /> }
      case 'reports':
        return isOwner ? { title: t('settings.tabs.reports'), content: <BugReports /> } : null
      case 'about':
        return { title: t('settings.tabs.about'), content: <AboutSettings /> }
    }
  }

  const current = GROUPS.find((g) => g.key === group)!
  const shown = current.sections.map((key) => [key, section(key)] as const).filter((s): s is readonly [Section, { title: string; content: ReactNode }] => !!s[1])

  return (
    <Modal title={t('settings.title')} tall onClose={onClose}>
      <div className="flex min-h-0 flex-1 gap-6">
        <nav aria-label={t('settings.title')} className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line pr-4">
          {GROUPS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              aria-current={group === key ? 'page' : undefined}
              onClick={() => {
                setGroup(key)
                body.current?.scrollTo?.({ top: 0 })
              }}
              className={`flex items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm font-medium ${
                group === key ? 'bg-accent/15 text-accent-text' : 'text-fg-muted hover:bg-elevated hover:text-fg'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="truncate">{t(`settings.groups.${key}`)}</span>
            </button>
          ))}
          <span className="flex-1" />
          <button type="button" onClick={logout} className="rounded-control px-3 py-2 text-left text-sm font-medium text-danger hover:bg-danger/10">
            {t('settings.logout')}
          </button>
        </nav>

        <div ref={body} className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
          {shown.map(([key, { title, content }], i) => (
            <Fragment key={key}>
              {i > 0 && <hr className="my-6 border-line" />}
              <section data-section={key} aria-label={title}>
                <h3 className="mb-3 font-display text-lg font-semibold">{title}</h3>
                {content}
              </section>
            </Fragment>
          ))}
        </div>
      </div>
    </Modal>
  )
}
