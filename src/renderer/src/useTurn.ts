import { useCallback, useEffect, useRef, useState } from 'react'

import { MIN_HOLD_MS, nextTurnState, type TurnFailure, type TurnState } from '../../domain/model/turn'
import { isEmpty } from '../../domain/model/transcript'
import { MicrophoneRecorder } from './audio/recorder'

export interface CompletedTurn {
  readonly id: number
  readonly you: string
}

/**
 * Ties the domain's turn machine to the microphone and the bridge.
 *
 * Every state change goes through `nextTurnState`, so the rules the machine enforces — key
 * repeat is a no-op, a hold under 250 ms is discarded, a second hold while busy is refused —
 * hold here too, rather than being reimplemented in an event handler and drifting.
 */
export function useTurn(): {
  state: TurnState
  level: number
  turns: readonly CompletedTurn[]
  notice: string | null
  beginHold: () => void
  endHold: () => void
  dismiss: () => void
} {
  const [state, setState] = useState<TurnState>({ k: 'idle' })
  const [level, setLevel] = useState(0)
  const [turns, setTurns] = useState<readonly CompletedTurn[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const recorder = useRef<MicrophoneRecorder | null>(null)
  const releaseWanted = useRef(false)
  const stateRef = useRef<TurnState>(state)
  stateRef.current = state

  const apply = useCallback((event: Parameters<typeof nextTurnState>[1]): TurnState => {
    const next = nextTurnState(stateRef.current, event)
    stateRef.current = next
    setState(next)
    return next
  }, [])

  const fail = useCallback(
    (failure: TurnFailure) => {
      apply({ t: 'failed', failure })
      setLevel(0)
    },
    [apply],
  )

  const beginHold = useCallback(() => {
    // The guard lives in the machine, not here: asking it first is what makes an auto-repeating
    // key, or a hold while the turn is busy, a no-op instead of a second recording.
    if (nextTurnState(stateRef.current, { t: 'hold-started', at: 0 }) === stateRef.current) return
    if (recorder.current !== null) return // a start is already in flight

    setNotice(null)
    releaseWanted.current = false
    const mic = new MicrophoneRecorder()
    recorder.current = mic

    void (async () => {
      try {
        const started = await mic.start()
        if (started.k === 'failed') {
          recorder.current = null
          fail(started.failure)
          return
        }
        // The user can let go while `getUserMedia` is still resolving — the permission prompt
        // alone takes seconds the first time. Without this the release is dropped by the
        // state guard and the microphone stays open with the interface back at rest.
        if (releaseWanted.current) {
          recorder.current = null
          await mic.release()
          return
        }
        // Only now is the microphone actually live, so this is when the state may say so.
        // `startedAt` comes from the recorder, so the machine measures the hold on the same
        // clock the recorder does rather than on one that started later.
        apply({ t: 'hold-started', at: mic.startedAtMs })
      } catch (error) {
        recorder.current = null
        fail({ kind: 'transcribe-failed', stderr: `could not open the microphone: ${String(error)}` })
      }
    })()
  }, [apply, fail])

  const endHold = useCallback(() => {
    const mic = recorder.current
    if (mic === null) return
    // The hold ended before the microphone finished opening. Record the intent; `beginHold`
    // honours it as soon as `start()` returns.
    if (stateRef.current.k !== 'recording') {
      releaseWanted.current = true
      return
    }
    recorder.current = null

    void (async () => {
      try {
        const clip = await mic.stop()
        setLevel(0)
        // Ended on the recorder's own clock, so the 250 ms rule measures the whole hold.
        const after = apply({ t: 'hold-ended', at: mic.startedAtMs + clip.heldMs })

        // A tap under the minimum never reaches transcription; say so quietly rather than
        // failing, because it is a slip, not an error.
        if (after.k !== 'transcribing') {
          if (clip.heldMs < MIN_HOLD_MS) setNotice('tooShort')
          return
        }

        const result = await window.voicedesk.transcribe({
          pcm: toArrayBuffer(clip.samples),
          sampleRate: Math.round(clip.sampleRate),
          heldMs: Math.round(clip.heldMs),
        })

        if (result.k === 'failed') {
          fail(result.failure)
          return
        }

        // The domain owns what counts as silence; `text === ''` would let a punctuation-only
        // whisper hallucination through as a real turn.
        const transcript = { text: result.value.text.trim(), heldMs: result.value.heldMs }
        if (isEmpty(transcript)) {
          fail({ kind: 'empty-speech' })
          return
        }
        const text = transcript.text

        setTurns((previous) => [...previous, { id: Date.now(), you: text }])
        // Iteration 1 ends at the transcript on screen; the agent step lands in iteration 2,
        // and until it does the turn completes here rather than pretending to think.
        apply({ t: 'transcribed' })
        apply({ t: 'replied', speech: 'not-requested' })
      } catch (error) {
        // Nothing may leave the turn suspended. A rejection with no handler is how a broken
        // bridge presented as an interface stuck in "transcribing" for ever, with no error
        // anywhere: the state machine simply never received another event.
        await mic.release()
        fail({ kind: 'transcribe-failed', stderr: String(error) })
      }
    })()
  }, [apply, fail])

  const dismiss = useCallback(() => apply({ t: 'dismissed' }), [apply])

  // The meter is driven from a frame loop, and only while recording. A meter that keeps
  // running after the hold is a meter that lies about the microphone being open.
  useEffect(() => {
    if (state.k !== 'recording') return undefined
    let frame = 0
    const tick = (): void => {
      setLevel(recorder.current?.level() ?? 0)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [state.k])

  // The fourth hold-ending event. `pointerup` is not guaranteed to arrive — the OS steals
  // focus, the pointer leaves the button — and a recording that never stops is the bug this
  // catches.
  useEffect(() => {
    window.addEventListener('blur', endHold)
    return () => window.removeEventListener('blur', endHold)
  }, [endHold])

  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat) return
      event.preventDefault()
      beginHold()
    }
    const up = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return
      event.preventDefault()
      endHold()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [beginHold, endHold])

  return { state, level, turns, notice, beginHold, endHold, dismiss }
}

/**
 * The bridge takes an ArrayBuffer; hand it exactly the recorded bytes and no more.
 *
 * Built by copying into a fresh buffer rather than slicing the view's own: `Float32Array.buffer`
 * is an `ArrayBufferLike`, so slicing it needs a cast to claim it is an `ArrayBuffer`, and that
 * claim is exactly the kind the compiler cannot check.
 */
function toArrayBuffer(samples: Float32Array): ArrayBuffer {
  const copy = new ArrayBuffer(samples.byteLength)
  new Float32Array(copy).set(samples)
  return copy
}
