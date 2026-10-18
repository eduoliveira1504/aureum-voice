import { create } from 'zustand'

import type { Activity } from '../lib/api'
import type { ServerEvent } from '../lib/realtime'

/** What people are playing, by user id. Filled from the WebSocket: a snapshot on connect, then
 *  activity.updated and presence.updated (going offline/invisible clears it). */
interface ActivityState {
  byUser: Record<string, Activity>
  applyEvent(event: ServerEvent): void
}

export const useActivity = create<ActivityState>()((set) => ({
  byUser: {},
  applyEvent: ({ type, data }) => {
    if (type === 'activity.snapshot') return set({ byUser: data })
    if (type !== 'activity.updated' && type !== 'presence.updated') return
    set((s) => {
      const byUser = { ...s.byUser }
      if (data.activity) byUser[data.user_id] = data.activity
      else delete byUser[data.user_id]
      return { byUser }
    })
  }
}))

export const useUserActivity = (userId: string): Activity | undefined => useActivity((s) => s.byUser[userId])
