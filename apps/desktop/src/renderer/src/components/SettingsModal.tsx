import { useState, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { AboutSettings } from './AboutSettings'
import { AccountSettings, InvitesSettings } from './AccountSettings'
import { ActivitySettings } from './ActivitySettings'
import { AppearanceSettings } from './AppearanceSettings'
import { BugReports } from './BugReports'
import { useUnsavedGuard } from './EditProfileModal'
import { Modal, ModalBody, ModalTabs } from './Modal'
import { NotificationSettings } from './NotificationSettings'
import { OverlaySettings } from './OverlaySettings'
import { PrivacySettings } from './PrivacySettings'
import { ProfileEditor } from './ProfileEditor'
import { SoundSettings } from './SoundSettings'
import { VoiceSettings } from './VoiceSettings'
import { WindowsSettings } from './WindowsSettings'

type Tab =
  | 'profile'
  | 'account'
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

export function SettingsModal({ onClose, initialTab = 'profile' }: { onClose(): void; initialTab?: Tab }): ReactNode {
  const { state, logout } = useAuth()
  const [tab, setTab] = useState<Tab>(initialTab)
  const isOwner = state.status === 'signedIn' && state.user.is_app_owner
  // Leaving Meu perfil (another tab, closing) with changes not saved asks first.
  const { setDirty, guard, dialog } = useUnsavedGuard()
  const close = (): void => guard(onClose)

  return (
    <Modal title="Configurações" tall onClose={close}>
      <ModalTabs<Tab>
        tabs={
          [
            ['profile', 'Meu perfil'],
            ['account', 'Conta'],
            ['invites', 'Convites'],
            ['activity', 'Atividade'],
            ['appearance', 'Aparência'],
            ['voice', 'Voz e vídeo'],
            ['sounds', 'Sons'],
            ['notifications', 'Notificações'],
            ['privacy', 'Privacidade'],
            ['overlay', 'Overlay'],
            ['windows', 'Windows'],
            ...(isOwner ? ([['reports', 'Problemas']] as const) : []),
            ['about', 'Sobre']
          ] as const
        }
        isCurrent={(key) => tab === key}
        onSelect={(next) => guard(() => setTab(next))}
      />

      <ModalBody>
        {tab === 'profile' && state.status === 'signedIn' && <ProfileEditor user={state.user} onDirtyChange={setDirty} />}
        {tab === 'account' && state.status === 'signedIn' && <AccountSettings user={state.user} />}
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
        <button type="button" onClick={() => guard(logout)} className="rounded-control px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10">
          Sair da conta
        </button>
      </div>
      {dialog}
    </Modal>
  )
}

