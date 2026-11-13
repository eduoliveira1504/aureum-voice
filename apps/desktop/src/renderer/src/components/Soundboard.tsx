import { Pencil, Play, Plus, Scissors, Smile, Square, Trash2, Volume2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { api, ApiError, uploadFile, type ServerDetail, type Sound } from '../lib/api'
import { clipWav, decodeSoundFile, firstClip, MAX_CLIP_SECONDS, SoundFileError, type Selection } from '../lib/soundTrim'
import { useAppearance } from '../store/appearance'
import { MAX_SOUND_BYTES, MAX_SOUNDS, playHere, soundUrl, useSoundboard } from '../store/soundboard'
import { useVoice } from '../store/voice'
import { pickEmoji, Emoji } from './Emoji'
import { ConfirmModal } from './modals'
import { FormError } from './Modal'
import { SoundTrimEditor } from './SoundTrimEditor'
import { cn, inputClass, labelClass, PrimaryButton, ToggleRow } from './ui'
import { numberFormat } from '../lib/format'
import { t } from '../lib/i18n'

const NO_SOUNDS: Sound[] = []
// What the API takes as it is; anything else has to go up as a cut WAV.
const AS_UPLOADED = /\.(mp3|ogg|wav)$/i

function soundError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return t('sounds.tooBig')
    if (err.status === 415) return t('sounds.format')
    if (err.status === 409) return t('sounds.limit', { count: MAX_SOUNDS })
    if (err.status === 403) return t('server.forbidden')
    if (err.status === 422) {
      return typeof err.detail === 'string' && err.detail.includes('seconds')
        ? t('sounds.tooLong')
        : t('sounds.invalid')
    }
  }
  return t('sounds.error')
}

export const seconds = (ms: number): string => `${numberFormat({ maximumFractionDigits: 1 }).format(ms / 1000)} s`

/** Plays one thing at a time here; clicking the playing one again stops it. */
function usePreview(): { playing: string | null; toggle(key: string, src: () => Promise<string>, volume: number): void } {
  const [playing, setPlaying] = useState<string | null>(null)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  return {
    playing,
    toggle: (key, src, volume) => {
      stop.current?.()
      stop.current = null
      if (playing === key) return setPlaying(null)
      setPlaying(key)
      void src().then((url) => {
        const halt = playHere(url, volume)
        const timer = window.setTimeout(() => setPlaying((p) => (p === key ? null : p)), 5200)
        stop.current = () => {
          halt()
          window.clearTimeout(timer)
        }
      }, () => setPlaying(null))
    }
  }
}

/** Add, preview, rename, change and remove the server's sounds (MANAGE_SOUNDBOARD). */
export function ServerSoundsTab({ server }: { server: ServerDetail }): ReactNode {
  const sounds = useSoundboard((s) => s.byServer[server.id] ?? NO_SOUNDS)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState<string | null>(null)
  const [volume, setVolume] = useState(100)
  const [file, setFile] = useState<File | null>(null)
  const [decoded, setDecoded] = useState<AudioBuffer | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [trimming, setTrimming] = useState(false)
  const [removing, setRemoving] = useState<Sound | null>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const preview = usePreview()
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (fileUrl && URL.revokeObjectURL(fileUrl)), [fileUrl])

  const reload = (): Promise<void> => useSoundboard.getState().load(server.id)
  useEffect(() => void reload().catch(() => {}), [server.id])

  const choose = (picked: File | null): void => {
    setFile(null)
    setDecoded(null)
    setSelection(null)
    setTrimming(false)
    setError(null)
    if (!picked) return
    setBusy(true)
    decodeSoundFile(picked)
      .then((buffer) => {
        setFile(picked)
        setDecoded(buffer)
        setSelection(firstClip(buffer.duration))
        // A short file that the API takes can go straight; the editor stays one click away.
        setTrimming(buffer.duration > MAX_CLIP_SECONDS || picked.size > MAX_SOUND_BYTES || !AS_UPLOADED.test(picked.name))
      })
      .catch((err) => setError(err instanceof SoundFileError ? err.message : t('sounds.unreadable')))
      .finally(() => setBusy(false))
  }

  async function add(): Promise<void> {
    if (!file || !decoded || !selection || name.trim().length < 2) return
    setBusy(true)
    setError(null)
    try {
      const fields = { name: name.trim(), volume: String(volume), ...(emoji && { emoji }) }
      const upload = trimming ? clipWav(decoded, selection) : file
      const uploadName = trimming ? `${file.name.replace(/\.[^.]*$/, '')}.wav` : file.name
      await uploadFile(`/servers/${server.id}/sounds`, upload, uploadName, () => {}, fields).done
      setName('')
      setEmoji(null)
      setVolume(100)
      choose(null)
      await reload()
    } catch (err) {
      setError(soundError(err))
    } finally {
      setBusy(false)
    }
  }

  async function change(sound: Sound, body: { name?: string; emoji?: string; volume?: number }): Promise<void> {
    setError(null)
    try {
      await api(`/sounds/${sound.id}`, { method: 'PATCH', body })
      await reload()
    } catch (err) {
      setError(soundError(err))
    }
  }

  const full = sounds.length >= MAX_SOUNDS
  return (
    <div className="max-w-[560px] space-y-5">
      <FormError message={error} />
      <div className="space-y-2">
        <span className={labelClass}>{t('sounds.new')}</span>
        <div className="space-y-2 rounded-control border border-line bg-main p-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => filePicker.current?.click()}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-control border border-dashed border-line px-3 py-2 text-left text-sm text-fg-subtle hover:text-fg"
            >
              <Plus size={16} className="shrink-0" />
              <span className="truncate">{file ? file.name : t('sounds.pickFile')}</span>
            </button>
            <input
              ref={filePicker}
              type="file"
              accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4,.mp3,.ogg,.wav,.m4a"
              hidden
              onChange={(e) => {
                choose(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={!fileUrl}
              title={t('sounds.listen')}
              aria-label={t('sounds.listenFile')}
              onClick={() => fileUrl && preview.toggle('new', async () => fileUrl, volume)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-line text-fg-subtle hover:text-fg disabled:opacity-40"
            >
              {preview.playing === 'new' ? <Square size={14} /> : <Play size={16} />}
            </button>
            <button
              type="button"
              disabled={!decoded}
              title={t('sounds.trim')}
              aria-label={t('sounds.trimFile')}
              aria-pressed={trimming}
              onClick={() => setTrimming(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-line text-fg-subtle hover:text-fg disabled:opacity-40"
            >
              <Scissors size={16} />
            </button>
          </div>
          {trimming && decoded && selection && <SoundTrimEditor buffer={decoded} selection={selection} volume={volume} onChange={setSelection} />}
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              placeholder={t('sounds.namePlaceholder')}
              aria-label={t('sounds.name')}
              className={cn(inputClass, 'flex-1')}
            />
            <button
              type="button"
              title={t('sounds.emoji')}
              aria-label={t('sounds.emoji')}
              onClick={(e) => pickEmoji(e.currentTarget, setEmoji)}
              onContextMenu={(e) => {
                e.preventDefault()
                setEmoji(null)
              }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-line bg-main text-fg-subtle hover:text-fg"
            >
              {emoji ? <Emoji emoji={emoji} size={22} /> : <Smile size={18} />}
            </button>
          </div>
          <VolumeRow label={t('sounds.defaultVolume')} value={volume} onChange={setVolume} />
          <PrimaryButton type="button" disabled={busy || !file || name.trim().length < 2 || full} onClick={() => void add()}>
            {busy ? t('common.sending') : t('sounds.add')}
          </PrimaryButton>
        </div>
        <p className="text-xs text-fg-subtle">
          {t('sounds.rules', { used: sounds.length, max: MAX_SOUNDS })}
        </p>
      </div>

      {sounds.length > 0 && (
        <ul className="space-y-2">
          {sounds.map((sound) => (
            <SoundItem
              key={sound.id}
              sound={sound}
              playing={preview.playing === sound.id}
              onPreview={() => preview.toggle(sound.id, () => soundUrl(sound), sound.volume)}
              onChange={(body) => change(sound, body)}
              onRemove={() => setRemoving(sound)}
            />
          ))}
        </ul>
      )}

      {removing && (
        <ConfirmModal
          title={t('sounds.removeTitle')}
          message={t('sounds.removeConfirm', { name: removing.name })}
          confirmLabel={t('common.remove')}
          onConfirm={async () => {
            await api(`/sounds/${removing.id}`, { method: 'DELETE' })
            await reload()
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

/** A 0-100 slider. `onCommit` runs when it's let go (saving on every step would flood the API). */
function VolumeRow({ label, value, onChange, onCommit }: { label: string; value: number; onChange(v: number): void; onCommit?(): void }): ReactNode {
  return (
    <label className="flex items-center gap-3 text-sm text-fg-muted">
      <Volume2 size={16} className="shrink-0" aria-hidden />
      <span className="sr-only">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="flex-1 accent-accent"
      />
      <span className="w-10 text-right tabular-nums">{value}%</span>
    </label>
  )
}

function SoundItem({
  sound,
  playing,
  onPreview,
  onChange,
  onRemove
}: {
  sound: Sound
  playing: boolean
  onPreview(): void
  onChange(body: { name?: string; emoji?: string; volume?: number }): Promise<void>
  onRemove(): void
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(sound.name)
  const [volume, setVolume] = useState(sound.volume)
  useEffect(() => setVolume(sound.volume), [sound.volume])
  const button = 'rounded-item p-1.5 hover:bg-elevated hover:text-fg'
  return (
    <li className="space-y-1.5 rounded-control border border-line bg-main px-3 py-2">
      <div className="flex items-center gap-2">
        <button type="button" title={t('sounds.listen')} aria-label={t('sounds.listenNamed', { name: sound.name })} onClick={onPreview} className={cn(button, 'text-fg-subtle')}>
          {playing ? <Square size={14} /> : <Play size={14} />}
        </button>
        {sound.emoji && <Emoji emoji={sound.emoji} size={18} />}
        {editing ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim().length >= 2) void onChange({ name: name.trim() }).then(() => setEditing(false))
            }}
          >
            <input autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)}
              aria-label={t('sounds.newName')} className={cn(inputClass, 'py-1 text-sm')} />
          </form>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm">{sound.name}</span>
        )}
        <span className="text-xs tabular-nums text-fg-subtle">{seconds(sound.duration_ms)}</span>
        <div className="flex text-fg-subtle">
          <button type="button" title={t('sounds.rename')} aria-label={t('sounds.renameNamed', { name: sound.name })} onClick={() => setEditing(true)} className={button}>
            <Pencil size={14} />
          </button>
          <button
            type="button"
            title={t('sounds.changeEmoji')}
            aria-label={t('sounds.changeEmojiOf', { name: sound.name })}
            onClick={(e) => pickEmoji(e.currentTarget, (emoji) => void onChange({ emoji }))}
            onContextMenu={(e) => {
              e.preventDefault()
              void onChange({ emoji: '' })
            }}
            className={button}
          >
            <Smile size={14} />
          </button>
          <button type="button" title={t('common.remove')} aria-label={t('sounds.removeNamed', { name: sound.name })} onClick={onRemove} className={cn(button, 'hover:text-danger')}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <VolumeRow label={t('sounds.volumeOf', { name: sound.name })} value={volume} onChange={setVolume} onCommit={() => volume !== sound.volume && void onChange({ volume })} />
    </li>
  )
}


/** Re-renders until `until` (ms epoch) passes, so a cooldown un-greys the grid on its own. */
function useUntil(until: number): boolean {
  const [, tick] = useState(0)
  const waiting = Date.now() < until
  useEffect(() => {
    if (!waiting) return
    const timer = window.setTimeout(() => tick((n) => n + 1), until - Date.now() + 20)
    return () => window.clearTimeout(timer)
  }, [until, waiting])
  return waiting
}

/** The call's Painel de sons: the server's sounds as a grid (emoji + name); a click plays one in
 * the room. One at a time, 3 s apart (the API holds the same rule). */
export function SoundboardGrid({ serverId, canManage }: { serverId: string; canManage: boolean }): ReactNode {
  const sounds = useSoundboard((s) => s.byServer[serverId])
  const playing = useVoice((s) => s.boardSound)
  const until = useVoice((s) => s.boardUntil)
  const waiting = useUntil(until)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    void useSoundboard.getState().load(serverId).catch(() => setFailed(true))
  }, [serverId])

  if (!sounds) {
    return <p className="py-6 text-center text-fg-subtle">{failed ? t('sounds.loadFailed') : t('common.loading')}</p>
  }
  if (!sounds.length) {
    return (
      <p className="py-4 text-center text-fg-subtle">
        {t('sounds.empty')}
        {canManage && <span className="block text-xs">{t('sounds.addHint')}</span>}
      </p>
    )
  }
  return (
    <ul className="grid grid-cols-3 gap-1.5" aria-label={t('sounds.list')}>
      {sounds.map((sound) => (
        <li key={sound.id}>
          <button
            type="button"
            title={`${sound.name} (${seconds(sound.duration_ms)})`}
            aria-label={t('sounds.play', { name: sound.name })}
            disabled={!!playing || waiting}
            onClick={() => void useVoice.getState().playBoardSound(sound)}
            className={cn(
              'flex h-16 w-full flex-col items-center justify-center gap-1 rounded-control border px-1 text-xs transition-colors disabled:cursor-not-allowed',
              playing === sound.id ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-panel hover:bg-elevated disabled:opacity-50'
            )}
          >
            {sound.emoji ? <Emoji emoji={sound.emoji} size={22} /> : <Volume2 size={20} className="text-fg-subtle" />}
            <span className="w-full truncate">{sound.name}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}


/** Each person's own: how loud others' sounds play (0-100 %) and "Silenciar sons dos outros".
 * Saved with the other settings (every PC); in Configurações › Sons and under the call's grid. */
export function SoundboardPrefs({ compact = false }: { compact?: boolean }): ReactNode {
  const volume = useAppearance((s) => s.settings.soundboard_volume)
  const muted = useAppearance((s) => s.settings.soundboard_muted)
  const update = useAppearance((s) => s.update)
  return (
    <div className={compact ? 'space-y-2 border-t border-line pt-3' : 'space-y-2'}>
      <div className={cn(muted && 'opacity-50')}>
        <VolumeRow label={t('sounds.othersVolume')} value={volume} onChange={(v) => update({ soundboard_volume: v })} />
      </div>
      <ToggleRow
        title={t('sounds.muteOthers')}
        description={compact ? t('sounds.muteOthersShort') : t('sounds.muteOthersHint')}
        checked={muted}
        onChange={(on) => update({ soundboard_muted: on })}
      />
    </div>
  )
}
