import { describe, expect, it } from 'vitest'

import type { Dm, Message } from '../lib/api'
import { useSocial } from '../store/social'
import { receiptMarks } from './ChatView'

const msg = (id: number, author: string, extra: Partial<Message> = {}): Message =>
  ({ id, author: { id: author }, call: null, system: null, ...extra }) as unknown as Message

describe('read receipts in 1:1 DMs', () => {
  const items = [msg(1, 'me'), msg(2, 'bia'), msg(3, 'me'), msg(4, 'me')]

  it('marks only the last seen and the last sent of mine', () => {
    expect([...receiptMarks(items, 'me', 3)]).toEqual([
      [3, 'seen'],
      [4, 'sent']
    ])
    expect([...receiptMarks(items, 'me', 4)]).toEqual([[4, 'seen']])
    // Nothing of mine read yet: only "Enviada" on the last one.
    expect([...receiptMarks(items, 'me', 0)]).toEqual([[4, 'sent']])
  })

  it('shows nothing while receipts are off', () => {
    expect(receiptMarks(items, 'me', null).size).toBe(0)
    expect(receiptMarks(items, 'me', undefined).size).toBe(0)
  })

  it('skips call lines', () => {
    expect([...receiptMarks([msg(1, 'me'), msg(2, 'me', { call: {} as Message['call'] })], 'me', 2)]).toEqual([[1, 'seen']])
  })

  it('follows dm.read live', () => {
    const dm = { id: 'd1', type: 'dm', members: [], last_message_id: 4, peer_read_message_id: 1 } as unknown as Dm
    useSocial.setState({ dms: { d1: dm } })
    useSocial.getState().applyEvent({ type: 'dm.read', data: { channel_id: 'd1', last_read_message_id: 4 } })
    expect(useSocial.getState().dms.d1.peer_read_message_id).toBe(4)
    useSocial.getState().applyEvent({ type: 'dm.read', data: { channel_id: 'd1', last_read_message_id: null } })
    expect(useSocial.getState().dms.d1.peer_read_message_id).toBeNull()
  })
})
