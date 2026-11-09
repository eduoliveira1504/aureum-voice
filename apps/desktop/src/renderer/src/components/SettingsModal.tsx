import { useState, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { AboutSettings } from './AboutSettings'
import { InvitesSettings } from './AccountSettings'
import { ActivitySettings } from './ActivitySettings'
import { AppearanceSettings } from './AppearanceSettings'
import { BugReports } from './BugReports'
import { Modal, ModalBody, ModalTabs } from './Modal'
import { NotificationSettings } from './NotificationSettings'
import { OverlaySettings } from './OverlaySettings'
import { PrivacySettings } from './PrivacySettings'
import { SoundSettings } from './SoundSettings'
import { VoiceSettings } from './VoiceSettings'
import { WindowsSettings } from './WindowsSettings'
import { isMac } from '../lib/platform'

type Tab =
  | 'invites'
  | 'activity'
  | 'appearance'
  | 'voice'
  | 'sounds'
  | 'notifications'
  | 'privacy'
  | 'overlay'
  | 'windows'
  | 'reports'
  | 'about'

export function SettingsModal({ onClose, initialTab = 'invites' }: { onClose(): void; initialTab?: Tab }): ReactNode {
  const { state, logout } = useAuth()
  const [tab, setTab] = useState<Tab>(initialTab)
  const isOwner = state.status === 'signedIn' && state.user.is_app_owner

  return (
    <Modal title="Configurações" tall onClose={onClose}>
      <ModalTabs<Tab>
        tabs={
          [
            ['invites', 'Convites'],
            ['activity', 'Atividade'],
            ['appearance', 'Aparência'],
            ['voice', 'Voz e vídeo'],
            ['sounds', 'Sons'],
            ['notifications', 'Notificações'],
            ['privacy', 'Privacidade'],
            // The overlay is Windows only; the app's own settings are the "Mac" tab there.
            ...(isMac() ? ([] as const) : ([['overlay', 'Overlay']] as const)),
            ['windows', isMac() ? 'Mac' : 'Windows'],
            ...(isOwner ? ([['reports', 'Problemas']] as const) : []),
            ['about', 'Sobre']
          ] as const
        }
        isCurrent={(key) => tab === key}
        onSelect={setTab}
      />

      <ModalBody>
        {tab === 'invites' && state.status === 'signedIn' && <InvitesSettings user={state.user} />}
        {tab === 'activity' && <ActivitySettings />}
        {tab === 'appearance' && <AppearanceSettings />}
        {tab === 'voice' && <VoiceSettings />}
        {tab === 'sounds' && <SoundSettings />}
        {tab === 'notifications' && <NotificationSettings />}
        {tab === 'privacy' && <PrivacySettings />}
        {tab === 'overlay' && <OverlaySettings />}
        {tab === 'windows' && <WindowsSettings />}
        {tab === 'reports' && isOwner && <BugReports />}
        {tab === 'about' && <AboutSettings />}
      </ModalBody>

      <div className="mt-5 shrink-0 border-t border-line pt-4">
        <button type="button" onClick={logout} className="rounded-control px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10">
          Sair da conta
        </button>
      </div>
    </Modal>
  )
}

