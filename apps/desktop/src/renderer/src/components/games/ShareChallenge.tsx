import { useState, type ReactNode } from 'react'

import { channelPermissions, has, Perm } from '../../lib/permissions'
import { orderedChannels } from '../../lib/channelOrder'
import { shareChallenge, type DailyGameKey } from '../../lib/daily'
import { t } from '../../lib/i18n'
import { useChat } from '../../store/chat'
import { useSocial } from '../../store/social'
import { FormError, Modal } from '../Modal'
import { Avatar, inputClass, labelClass, PrimaryButton } from '../ui'

export type ShareTarget = 'friends' | 'server'

/**
 * Sends a solved game's result as a challenge (block 4.2.10): to friends (each gets it in the DM)
 * or to a server text channel the user can write in. Only the time and tries go.
 */
export function ShareChallengeModal({
  game,
  gameLabel,
  day,
  target,
  onClose
}: {
  game: DailyGameKey
  gameLabel: string
  day: string
  target: ShareTarget
  onClose(): void
}): ReactNode {
  const friends = Object.values(useSocial((s) => s.friends)).filter((f) => f.kind === 'friend')
  const servers = useChat((s) => s.servers)
  const order = useChat((s) => s.order)
  const meId = useChat((s) => s.meId)
  const [picked, setPicked] = useState<string[]>([])
  const [serverId, setServerId] = useState(order[0] ?? '')
  const server = servers[serverId]
  const writable = server && meId
    ? orderedChannels(server).filter((c) => {
        const perms = channelPermissions(server, c, meId)
        return c.type === 'text' && has(perms, Perm.VIEW_CHANNEL) && has(perms, Perm.SEND_MESSAGES)
      })
    : []
  const [channelId, setChannelId] = useState('')
  const channel = writable.find((c) => c.id === channelId) ?? writable[0]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ shared: number; already: number } | null>(null)

  async function send(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const ids = target === 'friends' ? await Promise.all(picked.map((id) => useSocial.getState().ensureDm(id))) : channel ? [channel.id] : []
      const res = await shareChallenge(game, day, ids)
      setDone({ shared: res.shared.length, already: res.already.length })
    } catch {
      setError(t('games.share.failed'))
    } finally {
      setBusy(false)
    }
  }

  const ready = target === 'friends' ? picked.length > 0 : !!channel
  return (
    <Modal title={t('games.share.title', { game: gameLabel })} subtitle={t('games.share.hint')} onClose={onClose}>
      <FormError message={error} />
      {done ? (
        <div className="space-y-1 py-4 text-center text-sm">
          {done.shared > 0 && <p className="font-semibold">{t('games.share.sent', { count: done.shared })}</p>}
          {done.already > 0 && <p className="text-fg-muted">{t('games.share.already', { count: done.already })}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {target === 'friends' ? (
            friends.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('games.share.noFriends')}</p>
            ) : (
              <fieldset>
                <legend className={labelClass}>{t('games.share.pickFriends')}</legend>
                <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                  {friends.map(({ user }) => (
                    <li key={user.id}>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-item px-2 py-1.5 hover:bg-elevated">
                        <input
                          type="checkbox"
                          checked={picked.includes(user.id)}
                          onChange={(e) => setPicked((p) => (e.target.checked ? [...p, user.id] : p.filter((id) => id !== user.id)))}
                          className="accent-accent"
                        />
                        <Avatar name={user.display_name} url={user.avatar_url} gif={user.avatar_gif} size={24} />
                        <span className="truncate text-sm">{user.display_name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )
          ) : (
            <>
              <label className="block">
                <span className={labelClass}>{t('games.share.serverLabel')}</span>
                <select value={serverId} onChange={(e) => setServerId(e.target.value)} className={inputClass}>
                  {order.filter((id) => servers[id]).map((id) => (
                    <option key={id} value={id}>
                      {servers[id].name}
                    </option>
                  ))}
                </select>
              </label>
              {writable.length === 0 ? (
                <p className="text-sm text-fg-muted">{t('games.share.noChannels')}</p>
              ) : (
                <label className="block">
                  <span className={labelClass}>{t('games.share.channel')}</span>
                  <select value={channel?.id ?? ''} onChange={(e) => setChannelId(e.target.value)} className={inputClass}>
                    {writable.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <PrimaryButton type="button" disabled={!ready || busy} onClick={() => void send()}>
            {busy ? t('games.share.sending') : t('games.share.send')}
          </PrimaryButton>
        </div>
      )}
    </Modal>
  )
}
