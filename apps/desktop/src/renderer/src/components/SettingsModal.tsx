import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../auth/AuthProvider'
import { AboutSettings } from './AboutSettings'
import { InvitesSettings } from './AccountSettings'
import { ActivitySettings } from './ActivitySettings'
import { AppearanceSettings } from './AppearanceSettings'
import { BugReports } from './BugReports'
import { LanguageSettings } from './LanguageSettings'
import { Modal, ModalBody, ModalTabs } from './Modal'
import { NotificationSettings } from './NotificationSettings'
import { OverlaySettings } from './OverlaySettings'
import { PrivacySettings } from './PrivacySettings'
import { SoundSettings } from './SoundSettings'
import { TipsSettings } from './TipsSettings'
import { VoiceSettings } from './VoiceSettings'
import { WindowsSettings } from './WindowsSettings'
import { isMac } from '../lib/platform'

type Tab =
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

export function SettingsModal({ onClose, initialTab = 'invites' }: { onClose(): void; initialTab?: Tab }): ReactNode {
  const { t } = useTranslation()
  const { state, logout } = useAuth()
  const [tab, setTab] = useState<Tab>(initialTab)
  const isOwner = state.status === 'signedIn' && state.user.is_app_owner

  return (
    <Modal title={t('settings.title')} tall onClose={onClose}>
      <ModalTabs<Tab>
        tabs={
          [
            ['invites', t('settings.tabs.invites')],
            ['activity', t('settings.tabs.activity')],
            ['appearance', t('settings.tabs.appearance')],
            ['language', t('settings.tabs.language')],
            ['voice', t('settings.tabs.voice')],
            ['sounds', t('settings.tabs.sounds')],
            ['notifications', t('settings.tabs.notifications')],
            ['privacy', t('settings.tabs.privacy')],
            ['tips', t('settings.tabs.tips')],
            // The overlay is Windows only; the app's own settings are the "Mac" tab there.
            ...(isMac() ? [] : [['overlay', t('settings.tabs.overlay')] as const]),
            ['windows', isMac() ? t('settings.tabs.mac') : t('settings.tabs.windows')],
            ...(isOwner ? [['reports', t('settings.tabs.reports')] as const] : []),
            ['about', t('settings.tabs.about')]
          ] as const
        }
        isCurrent={(key) => tab === key}
        onSelect={setTab}
      />

      <ModalBody>
        {tab === 'invites' && state.status === 'signedIn' && <InvitesSettings user={state.user} />}
        {tab === 'activity' && <ActivitySettings />}
        {tab === 'appearance' && <AppearanceSettings />}
        {tab === 'language' && <LanguageSettings />}
        {tab === 'voice' && <VoiceSettings />}
        {tab === 'sounds' && <SoundSettings />}
        {tab === 'notifications' && <NotificationSettings />}
        {tab === 'privacy' && <PrivacySettings />}
        {tab === 'tips' && <TipsSettings onClose={onClose} />}
        {tab === 'overlay' && <OverlaySettings />}
        {tab === 'windows' && <WindowsSettings />}
        {tab === 'reports' && isOwner && <BugReports />}
        {tab === 'about' && <AboutSettings />}
      </ModalBody>

      <div className="mt-5 shrink-0 border-t border-line pt-4">
        <button type="button" onClick={logout} className="rounded-control px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10">
          {t('settings.logout')}
        </button>
      </div>
    </Modal>
  )
}

