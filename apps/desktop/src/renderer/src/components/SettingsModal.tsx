import { useEffect, useState, type ReactNode } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { loadMediaPrefs, saveMediaPrefs, type MediaPrefs } from '../lib/mediaPrefs'
import { useVoice } from '../store/voice'
import { Modal } from './Modal'

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

export function SettingsModal({ onClose }: { onClose(): void }): ReactNode {
  const { logout } = useAuth()
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
      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-fg-muted">{label}</span>
      <select
        value={prefs[key]}
        onChange={(e) => update({ [key]: e.target.value })}
        className="w-full rounded-[3px] bg-surface-0 px-3 py-2.5 text-[15px] text-fg outline-none focus:ring-2 focus:ring-accent/60"
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
    <Modal title="Voz e vídeo" onClose={onClose}>
      <div className="space-y-4">
        {select('Microfone', 'audioInput', devices?.audioinput)}
        {select('Saída de áudio', 'audioOutput', devices?.audiooutput)}
        {select('Câmera', 'videoInput', devices?.videoinput)}
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded bg-surface-1 px-3 py-2.5">
          <span>
            <span className="block font-medium">Supressão de ruído</span>
            <span className="block text-xs text-fg-subtle">Reduz barulho de fundo, como teclado e ventilador.</span>
          </span>
          <input
            type="checkbox"
            checked={prefs.noiseSuppression}
            onChange={(e) => update({ noiseSuppression: e.target.checked })}
            className="h-5 w-5 accent-accent"
          />
        </label>
        <div className="border-t border-surface-3 pt-4">
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-[3px] px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10"
          >
            Sair da conta
          </button>
        </div>
      </div>
    </Modal>
  )
}
