import { useEffect, useState, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { loadMediaPrefs, saveMediaPrefs, type MediaPrefs } from '../lib/mediaPrefs'
import { useVoice } from '../store/voice'
import { ActivitySettings } from './ActivitySettings'
import { AppearanceSettings } from './AppearanceSettings'
import { BugReports } from './BugReports'
import { Modal } from './Modal'
import { OverlaySettings } from './OverlaySettings'
import { ProfileSettings } from './ProfileSettings'
import { SoundSettings } from './SoundSettings'
import { inputClass, labelClass, ToggleRow } from './ui'
import { WindowsSettings } from './WindowsSettings'

interface Devices {
  audioinput: MediaDeviceInfo[]
  audiooutput: MediaDeviceInfo[]
  videoinput: MediaDeviceInfo[]
}

async function listDevices(): Promise<Devices> {
  let all = await navigator.mediaDevices.enumerateDevices()
  // Device names are hidden until media access is granted once.
  if (all.some((d) => d.kind === 'audioinput' && !d.label)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      all = await navigator.mediaDevices.enumerateDevices()
    } catch {
      // No permission or no mic: list whatever we have.
    }
  }
  const of = (kind: MediaDeviceKind): MediaDeviceInfo[] => all.filter((d) => d.kind === kind && d.deviceId !== 'communications')
  return { audioinput: of('audioinput'), audiooutput: of('audiooutput'), videoinput: of('videoinput') }
}

type Tab = 'profile' | 'activity' | 'appearance' | 'voice' | 'sounds' | 'overlay' | 'windows' | 'reports'

export function SettingsModal({ onClose, initialTab = 'profile' }: { onClose(): void; initialTab?: Tab }): ReactNode {
  const { state, logout } = useAuth()
  const [tab, setTab] = useState<Tab>(initialTab)
  const isOwner = state.status === 'signedIn' && state.user.is_app_owner

  return (
    <Modal title="Configurações" wide onClose={onClose}>
      <div className="mb-5 flex gap-1 border-b border-line">
        {(
          [
            ['profile', 'Meu perfil'],
            ['activity', 'Atividade'],
            ['appearance', 'Aparência'],
            ['voice', 'Voz e vídeo'],
            ['sounds', 'Sons'],
            ['overlay', 'Overlay'],
            ['windows', 'Windows'],
            ...(isOwner ? ([['reports', 'Problemas']] as const) : [])
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {tab === 'profile' && state.status === 'signedIn' && <ProfileSettings user={state.user} />}
        {tab === 'activity' && <ActivitySettings />}
        {tab === 'appearance' && <AppearanceSettings />}
        {tab === 'voice' && <VoiceSettings />}
        {tab === 'sounds' && <SoundSettings />}
        {tab === 'overlay' && <OverlaySettings />}
        {tab === 'windows' && <WindowsSettings />}
        {tab === 'reports' && isOwner && <BugReports />}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <button type="button" onClick={logout} className="rounded-control px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10">
          Sair da conta
        </button>
      </div>
    </Modal>
  )
}

function VoiceSettings(): ReactNode {
  const applyDevicePrefs = useVoice((s) => s.applyDevicePrefs)
  const [prefs, setPrefs] = useState<MediaPrefs>(loadMediaPrefs)
  const [devices, setDevices] = useState<Devices | null>(null)

  useEffect(() => {
    void listDevices().then(setDevices)
    const onChange = (): void => void listDevices().then(setDevices)
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }, [])

  function update(patch: Partial<MediaPrefs>): void {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    saveMediaPrefs(next)
    void applyDevicePrefs()
  }

  const select = (label: string, key: 'audioInput' | 'audioOutput' | 'videoInput', list: MediaDeviceInfo[] | undefined): ReactNode => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select
        value={prefs[key]}
        onChange={(e) => update({ [key]: e.target.value })}
        className={inputClass}
      >
        <option value="">Padrão do sistema</option>
        {list?.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Dispositivo ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="max-w-[440px] space-y-4">
        {select('Microfone', 'audioInput', devices?.audioinput)}
        {select('Saída de áudio', 'audioOutput', devices?.audiooutput)}
        {select('Câmera', 'videoInput', devices?.videoinput)}
        <ToggleRow
          title="Supressão de ruído"
          description="Reduz barulho de fundo, como teclado e ventilador. Processado no seu PC, antes do áudio sair."
          checked={prefs.noiseSuppression}
          onChange={(noiseSuppression) => update({ noiseSuppression })}
        />
    </div>
  )
}
