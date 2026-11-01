/** A new version is one notification in the bell: unread until opened, then gone until the next. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CHANGELOG, releaseNotes } from '../lib/changelog'
import { useAppearance } from '../store/appearance'
import { NewsModal, useUnseenNews } from './NewsModal'

// The test bridge reports 0.0.0-test, which isn't listed: the newest released notes show.
const title = releaseNotes(CHANGELOG, '0.0.0-test')?.title

function Bell(): React.ReactNode {
  const news = useUnseenNews()
  return news.title ? <button onClick={news.markSeen}>{news.title}</button> : <span>nada</span>
}

const dismissed = (news_dismissed: string | null): void => {
  useAppearance.setState((s) => ({ settings: { ...s.settings, news_dismissed } }))
}

describe('the version notification', () => {
  beforeEach(() => dismissed(null))

  it('shows once and goes away when opened', async () => {
    const update = vi.fn((patch: { news_dismissed: string }) => dismissed(patch.news_dismissed))
    useAppearance.setState({ update } as never)
    render(<Bell />)
    const item = await screen.findByRole('button', { name: title })
    act(() => fireEvent.click(item))
    expect(update).toHaveBeenCalledWith({ news_dismissed: '0.0.0-test' })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('stays away for a version already seen', async () => {
    dismissed('0.0.0-test')
    render(<Bell />)
    await act(async () => {})
    expect(screen.getByText('nada')).toBeTruthy()
  })

  it('comes back for the next version', async () => {
    dismissed('0.0.0-older')
    render(<Bell />)
    expect(await screen.findByRole('button', { name: title })).toBeTruthy()
  })

  it('opens the same notes as before', () => {
    render(<NewsModal onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Novidades do Aureum' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
  })
})
