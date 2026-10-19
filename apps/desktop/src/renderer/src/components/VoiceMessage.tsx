import { ChevronLeft, Mic, SendHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { formatDuration, MAX_VOICE_MS, VoiceRecorder, type Recording } from '../lib/voiceRecorder'

// A press shorter than this is a click: the recording keeps going until sent or thrown away.
const CLICK_MS = 300
// Dragging this far left while holding throws the recording away on release.
const CANCEL_PX = 80
// Shorter recordings are dropped (a slip of the finger, not a message).
const MIN_MS = 500

type State =
  | { phase: 'idle' }
  | { phase: 'recording'; locked: boolean; cancelling: boolean; elapsed: number }
  | { phase: 'sending' }

/**
 * The mic button of the message field: hold to record and release to send, or click to start
 * and then send with the same button. While holding, dragging left cancels; Esc cancels too.
 * While recording, a bar covers the text field (`bar`, placed by the composer).
 */
export function useVoiceMessage(onSend: (recording: Recording) => Promise<void>, onError: (message: string) => void) {
  const [state, setState] = useState<State>({ phase: 'idle' })
  const recorder = useRef<Promise<VoiceRecorder | null> | null>(null)
  const press = useRef<{ x: number; at: number } | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const patch = (change: Partial<Extract<State, { phase: 'recording' }>>): void =>
    setState((s) => (s.phase === 'recording' ? { ...s, ...change } : s))

  function cancel(): void {
    void recorder.current?.then((r) => r?.cancel())
    recorder.current = null
    press.current = null
    setState({ phase: 'idle' })
  }

  async function finish(): Promise<void> {
    const pending = recorder.current
    recorder.current = null
    press.current = null
    const r = await pending
    if (!r) return setState({ phase: 'idle' })
    const recording = await r.stop()
    if (recording.durationMs < MIN_MS) return setState({ phase: 'idle' })
    setState({ phase: 'sending' })
    try {
      await onSend(recording)
    } finally {
      setState({ phase: 'idle' })
    }
  }

  function start(e: PointerEvent<HTMLButtonElement>): void {
    if (e.button !== 0 || stateRef.current.phase !== 'idle') return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { x: e.clientX, at: performance.now() }
    // The ref too: a quick click releases before the next render.
    stateRef.current = { phase: 'recording', locked: false, cancelling: false, elapsed: 0 }
    setState(stateRef.current)
    recorder.current = VoiceRecorder.start().then(
      (r) => {
        r.onTick = (elapsed) => patch({ elapsed })
        r.onLimit = () => void finish()
        return r
      },
      () => {
        onError('Não foi possível acessar o microfone. Confira as Configurações.')
        cancel()
        return null
      }
    )
  }

  function move(e: PointerEvent<HTMLButtonElement>): void {
    const s = stateRef.current
    if (!press.current || s.phase !== 'recording' || s.locked) return
    const cancelling = press.current.x - e.clientX > CANCEL_PX
    if (cancelling !== s.cancelling) patch({ cancelling })
  }

  function release(): void {
    const s = stateRef.current
    const pressed = press.current
    press.current = null
    if (!pressed || s.phase !== 'recording') return
    if (performance.now() - pressed.at < CLICK_MS) return patch({ locked: true })
    if (s.cancelling) cancel()
    else void finish()
  }

  // Esc throws the recording away; leaving the conversation does too.
  useEffect(() => {
    if (state.phase !== 'recording') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state.phase])
  useEffect(() => () => void recorder.current?.then((r) => r?.cancel()), [])

  const recording = state.phase === 'recording' ? state : null

  const button: ReactNode = recording?.locked ? (
    <button
      type="button"
      title="Enviar mensagem de voz"
      aria-label="Enviar mensagem de voz"
      onClick={() => void finish()}
      className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-hover"
    >
      <SendHorizontal size={18} />
    </button>
  ) : (
    <button
      type="button"
      title="Mensagem de voz: segure para gravar, ou clique"
      aria-label="Gravar mensagem de voz"
      disabled={state.phase === 'sending'}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={cancel}
      className={`mb-1 flex h-9 w-9 shrink-0 touch-none items-center justify-center rounded-full ${
        recording ? 'bg-danger text-on-danger' : 'bg-elevated text-fg-muted hover:bg-accent hover:text-on-accent'
      } disabled:opacity-50`}
    >
      <Mic size={18} />
    </button>
  )

  const bar: ReactNode =
    state.phase === 'sending' ? (
      <div className="absolute inset-0 flex items-center rounded-control border border-line bg-elevated px-4 text-sm text-fg-muted">
        Enviando mensagem de voz…
      </div>
    ) : recording ? (
      <div
        role="status"
        className="absolute inset-0 flex items-center gap-3 rounded-control border border-line bg-elevated px-4 text-sm"
      >
        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
        <span className="tabular-nums font-medium">
          {formatDuration(recording.elapsed)}
          <span className="text-fg-subtle"> / {formatDuration(MAX_VOICE_MS)}</span>
        </span>
        {recording.locked ? (
          <button
            type="button"
            onClick={cancel}
            className="ml-auto flex items-center gap-1.5 rounded-control px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
          >
            <Trash2 size={14} /> Descartar
          </button>
        ) : (
          <span className={`ml-auto flex items-center gap-1 text-xs ${recording.cancelling ? 'font-semibold text-danger' : 'text-fg-subtle'}`}>
            {recording.cancelling ? (
              'Solte para cancelar'
            ) : (
              <>
                <ChevronLeft size={14} /> Arraste para cancelar
              </>
            )}
          </span>
        )}
      </div>
    ) : null

  return { button, bar, busy: state.phase !== 'idle' }
}
