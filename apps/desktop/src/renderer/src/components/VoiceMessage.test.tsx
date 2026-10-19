import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Attachment } from '../lib/api'
import { VoiceRecorder, type Recording } from '../lib/voiceRecorder'
import { useVoiceMessage } from './VoiceMessage'
import { VoicePlayer } from './VoicePlayer'

const VOICE: Attachment = {
  id: 'a1',
  filename: 'mensagem-de-voz.webm',
  kind: 'voice',
  content_type: 'audio/webm',
  size: 1000,
  url: '/api/media/attachments/a1',
  duration_ms: 65_000,
  waveform: [10, 50, 100, 30]
}

describe('VoicePlayer', () => {
  it('shows the waveform, the duration and cycles the speed', () => {
    const { container } = render(<VoicePlayer attachment={VOICE} own={false} />)
    expect(container.querySelectorAll('[role="slider"] > span')).toHaveLength(4) // fewer samples than bars: one each
    expect(screen.getByText('1:05')).toBeTruthy()
    const speed = screen.getByLabelText('Velocidade 1x')
    fireEvent.click(speed)
    expect(screen.getByLabelText('Velocidade 1.5x')).toBeTruthy()
    fireEvent.click(speed)
    fireEvent.click(speed)
    expect(screen.getByLabelText('Velocidade 1x')).toBeTruthy()
  })

  it('squeezes a full waveform so it fits the bubble', () => {
    const { container } = render(<VoicePlayer attachment={{ ...VOICE, waveform: new Array(64).fill(50) }} own />)
    expect(container.querySelectorAll('[role="slider"] > span')).toHaveLength(40)
  })
})

function Harness({ onSend }: { onSend(r: Recording): Promise<void> }): ReactNode {
  const voice = useVoiceMessage(onSend, () => {})
  return (
    <div>
      {voice.bar}
      {voice.button}
    </div>
  )
}

function fakeRecorder(durationMs = 3000): { cancel: ReturnType<typeof vi.fn> } {
  const recorder = {
    onTick: () => {},
    onLimit: () => {},
    stop: vi.fn(async () => ({ blob: new Blob(['x']), durationMs, waveform: [50] })),
    cancel: vi.fn()
  }
  vi.spyOn(VoiceRecorder, 'start').mockResolvedValue(recorder as unknown as VoiceRecorder)
  return recorder
}

describe('voice message button', () => {
  afterEach(() => vi.restoreAllMocks())

  it('a click starts recording; the same button then sends', async () => {
    fakeRecorder()
    const onSend = vi.fn(async () => {})
    render(<Harness onSend={onSend} />)
    const mic = screen.getByLabelText('Gravar mensagem de voz')
    mic.setPointerCapture = () => {}
    await act(async () => {
      fireEvent.pointerDown(mic, { button: 0, clientX: 100 })
      fireEvent.pointerUp(mic, { clientX: 100 })
    })
    expect(screen.getByRole('status').textContent).toContain('Descartar')
    await act(async () => fireEvent.click(screen.getByLabelText('Enviar mensagem de voz')))
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 3000 }))
  })

  it('holding and dragging left cancels', async () => {
    const recorder = fakeRecorder()
    const onSend = vi.fn(async () => {})
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    render(<Harness onSend={onSend} />)
    const mic = screen.getByLabelText('Gravar mensagem de voz')
    mic.setPointerCapture = () => {}
    await act(async () => fireEvent.pointerDown(mic, { button: 0, clientX: 200 }))
    now.mockReturnValue(2000)
    await act(async () => fireEvent.pointerMove(mic, { clientX: 100 }))
    expect(screen.getByRole('status').textContent).toContain('Solte para cancelar')
    await act(async () => fireEvent.pointerUp(mic, { clientX: 100 }))
    expect(onSend).not.toHaveBeenCalled()
    expect(recorder.cancel).toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('holding and releasing sends', async () => {
    fakeRecorder()
    const onSend = vi.fn(async () => {})
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    render(<Harness onSend={onSend} />)
    const mic = screen.getByLabelText('Gravar mensagem de voz')
    mic.setPointerCapture = () => {}
    await act(async () => fireEvent.pointerDown(mic, { button: 0, clientX: 200 }))
    now.mockReturnValue(2000)
    await act(async () => fireEvent.pointerUp(mic, { clientX: 190 }))
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})
