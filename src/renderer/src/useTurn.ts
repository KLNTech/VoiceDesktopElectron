import { useCallback, useEffect, useRef, useState } from 'react'

import { MIN_HOLD_MS, nextTurnState, type TurnFailure, type TurnState } from '../../domain/model/turn'
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

    setNotice(null)
    const mic = new MicrophoneRecorder()
    recorder.current = mic

    void mic.start().then((started) => {
      if (started.k === 'failed') {
        recorder.current = null
        return fail(started.failure)
      }
      // Only now is the microphone actually live, so this is when the state may say so.
      apply({ t: 'hold-started', at: performance.now() })
    })
  }, [apply, fail])

  const endHold = useCallback(() => {
    const mic = recorder.current
    if (mic === null || stateRef.current.k !== 'recording') return
    recorder.current = null

    void mic.stop().then(async (clip) => {
      setLevel(0)
      const after = apply({ t: 'hold-ended', at: performance.now() })

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

      if (result.k === 'failed') return fail(result.failure)

      const text = result.value.text.trim()
      if (text === '') return fail({ kind: 'empty-speech' })

      setTurns((previous) => [...previous, { id: Date.now(), you: text }])
      // Iteration 1 ends at the transcript on screen; the agent step lands in iteration 2, and
      // until it does the turn completes here rather than pretending to think.
      apply({ t: 'transcribed' })
      apply({ t: 'replied', speech: 'not-requested' })
    })
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
