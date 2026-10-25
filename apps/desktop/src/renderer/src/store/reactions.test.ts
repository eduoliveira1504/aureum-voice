import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type Message } from '../lib/api'
import { toggleReaction, useChat } from './chat'

vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), api: vi.fn() }))

const message = { id: 1, channel_id: 'c1', reactions: [{ emoji: '🔥', count: 1, user_ids: ['ana'] }] } as unknown as Message
const items = (): Message[] => useChat.getState().messages.c1.items

beforeEach(() => {
  vi.mocked(api).mockReset()
  useChat.setState({ meId: 'me', messages: { c1: { items: [message], hasMore: false, loaded: true, loading: false } } })
})

describe('reactions in the store', () => {
  it('adds and takes back mine', () => {
    const added = toggleReaction(message.reactions!, '🔥', 'me', true)
    expect(added).toEqual([{ emoji: '🔥', count: 2, user_ids: ['ana', 'me'] }])
    expect(toggleReaction(added, '🔥', 'me', true)).toBe(added)
    expect(toggleReaction(added, '🔥', 'me', false)).toEqual(message.reactions)
    expect(toggleReaction(message.reactions!, '🔥', 'ana', false)).toEqual([])
    expect(toggleReaction([], '👍', 'me', true)).toEqual([{ emoji: '👍', count: 1, user_ids: ['me'] }])
  })

  it('shows mine right away, then what the API says, and undoes it if it fails', async () => {
    let answer: (value: unknown) => void = () => {}
    vi.mocked(api).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const pending = useChat.getState().react(message, '👍', true)
    expect(items()[0].reactions).toEqual([...message.reactions!, { emoji: '👍', count: 1, user_ids: ['me'] }])
    expect(api).toHaveBeenCalledWith('/messages/1/reactions/%F0%9F%91%8D', { method: 'PUT' })
    answer([{ emoji: '👍', count: 1, user_ids: ['me'] }])
    await pending
    expect(items()[0].reactions).toEqual([{ emoji: '👍', count: 1, user_ids: ['me'] }])

    vi.mocked(api).mockRejectedValueOnce(new ApiError(422, 'too many'))
    await expect(useChat.getState().react(items()[0], '😂', true)).rejects.toThrow()
    expect(items()[0].reactions).toEqual([{ emoji: '👍', count: 1, user_ids: ['me'] }])
  })
})
