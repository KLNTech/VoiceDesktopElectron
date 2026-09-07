import { useCallback, useEffect, useRef, useState } from 'react'

import {
  holdExceeded,
  MIN_HOLD_MS,
  nextTurnState,
  type TurnFailure,
  type TurnState,
} from '../../domain/model/turn'
import { isEmpty } from '../../domain/model/transcript'
import type { NoteFile } from '../../domain/model/note-file'
import type { NoticeSchema } from '../../../shared/ipc'
import { MicrophoneRecorder } from './audio/recorder'
import type { CompletedTurn } from './components/TurnLog'

export interface TurnView {
  readonly state: TurnState
  readonly level: number
  readonly heldSeconds: number
  readonly turns: readonly CompletedTurn[]
  readonly notes: readonly NoteFile[]
  readonly notice: string | null
  readonly model: string
  readonly stage: string
  readonly notesDir: string
  readonly notices: readonly NoticeSchema[]
  readonly folderChosen: boolean
  readonly firstRun: boolean
  readonly speakable: boolean
  readonly beginHold: () => void
  readonly endHold: () => void
  readonly dismiss: () => void
  readonly cancel: () => void
  readonly speak: (text: string) => void
}

/**
 * Ties the domain's turn machine to the microphone and the bridge.
 *
 * Every state change goes through `nextTurnState`, so the rules the machine enforces — key
 * repeat is a no-op, a hold under 250 ms is discarded, a hold over 120 s is ended, a second
 * hold while the turn is busy is refused — hold here too, rather than being reimplemented in an
 * event handler and drifting.
 */
export function useTurn(): TurnView {
  const [state, setState] = useState<TurnState>({ k: 'idle' })
  const [level, setLevel] = useState(0)
  const [heldSeconds, setHeldSeconds] = useState(0)
  const [turns, setTurns] = useState<readonly CompletedTurn[]>([])
  const [notes, setNotes] = useState<readonly NoteFile[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [info, setInfo] = useState<{
    model: string
    stage: string
    notesDir: string
    notices: readonly NoticeSchema[]
  }>({ model: '', stage: 'dev', notesDir: '', notices: [] })
  const [everTalked, setEverTalked] = useState(false)
  const [speakable, setSpeakable] = useState(true)

  const recorder = useRef<MicrophoneRecorder | null>(null)
  const releaseWanted = useRef(false)
  const sessionId = useRef<string | null>(null)
  // Kept current by `apply`, never written during render: a ref touched while rendering can
  // leave the component showing a state the ref disagrees with.
  const stateRef = useRef<TurnState>(state)

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

  /** The folder, re-read after every turn: the panel claims to show the folder, so it asks it. */
  const refreshNotes = useCallback(async () => {
    const listing = await window.voicedesk.notes()
    setNotes(listing.files)
  }, [])

  useEffect(() => {
    void (async () => {
      const app = await window.voicedesk.appInfo()
      setInfo({
        model: app.agentModel,
        stage: app.stage,
        notesDir: app.notesDir,
        notices: app.notices,
      })
      await refreshNotes()
    })()
  }, [refreshNotes])

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
        setEverTalked(true)
        // Only now is the microphone actually live, so this is when the state may say so.
        // `startedAt` comes from the recorder, so the machine measures the hold on the same
        // clock the recorder does rather than on one that started later.
        apply({ t: 'hold-started', at: mic.startedAtMs })
      } catch (error) {
        recorder.current = null
        fail({
          kind: 'transcribe-failed',
          stderr: `could not open the microphone: ${String(error)}`,
        })
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
        setHeldSeconds(0)
        // Ended on the recorder's own clock, so the 250 ms rule measures the whole hold.
        const after = apply({ t: 'hold-ended', at: mic.startedAtMs + clip.heldMs })

        // A tap under the minimum never reaches transcription; say so quietly rather than
        // failing, because it is a slip, not an error.
        if (after.k !== 'transcribing') {
          if (clip.heldMs < MIN_HOLD_MS) setNotice('tooShort')
          return
        }

        const heard = await window.voicedesk.transcribe({
          pcm: toArrayBuffer(clip.samples),
          sampleRate: Math.round(clip.sampleRate),
          heldMs: Math.round(clip.heldMs),
        })
        if (heard.k === 'failed') {
          fail(heard.failure)
          return
        }

        // The domain owns what counts as silence; `text === ''` would let a punctuation-only
        // whisper hallucination through as a real turn.
        const transcript = { text: heard.value.text.trim(), heldMs: heard.value.heldMs }
        if (isEmpty(transcript)) {
          fail({ kind: 'empty-speech' })
          return
        }

        // The transcript goes on screen BEFORE the agent is asked anything: showing someone
        // their own words is a separate promise from answering them, and the agent step is the
        // long one (`docs/PLAN.md` §7 — three channels, for exactly this).
        const id = Date.now()
        setTurns((previous) => [
          ...previous,
          { id, at: clockTime(), you: transcript.text, agent: null, edited: [] },
        ])
        apply({ t: 'transcribed' })

        const answer = await window.voicedesk.ask({
          text: transcript.text,
          sessionId: sessionId.current,
        })
        if (answer.k === 'failed') {
          fail(answer.failure)
          return
        }

        // Carried so "add milk" and "what's on my list?" are one conversation across two spawns.
        sessionId.current = answer.value.sessionId
        setInfo((previous) => ({ ...previous, model: answer.value.model }))
        setNotes(answer.value.notes)
        setTurns((previous) =>
          previous.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  agent: answer.value.reply,
                  edited: answer.value.notes.filter((note) => note.status === 'edited'),
                }
              : entry,
          ),
        )
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

  /**
   * S9's control: the reply, read aloud, on request.
   *
   * A voice that will not start is never a failed turn — the answer is already on screen. It
   * withdraws the control instead, which is what `SpeechOutcome`'s third value is for.
   */
  const speak = useCallback((text: string) => {
    void (async () => {
      const spoken = await window.voicedesk.speak({ text })
      if (spoken.k === 'failed') setSpeakable(false)
    })()
  }, [])

  const dismiss = useCallback(() => {
    apply({ t: 'dismissed' })
    void refreshNotes()
  }, [apply, refreshNotes])

  /**
   * `Stop` on the long wait. It ends the TURN, not the child: main owns the deadline, and a
   * renderer that could kill a process would be a renderer with more authority than the bridge
   * gives it. The reply that eventually arrives is discarded by the state guard.
   */
  const cancel = useCallback(() => {
    apply({ t: 'replied', speech: 'not-requested' })
  }, [apply])

  // The meter and the hold timer are driven from a frame loop, and only while recording. A
  // meter that keeps running after the hold is a meter that lies about the microphone.
  useEffect(() => {
    if (state.k !== 'recording') return undefined
    let frame = 0
    const tick = (): void => {
      setLevel(recorder.current?.level() ?? 0)
      setHeldSeconds((performance.now() - state.startedAt) / 1000)
      // The ceiling, enforced where the clock already runs. `holdExceeded` is the domain's
      // rule rather than a comparison written here, so the interface and the machine cannot
      // disagree about how long is too long.
      if (holdExceeded(stateRef.current, performance.now())) {
        apply({ t: 'hold-capped' })
        endHold()
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [state, apply, endHold])

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

  return {
    state,
    level,
    heldSeconds,
    turns,
    notes,
    notice,
    model: info.model,
    stage: info.stage,
    notesDir: info.notesDir,
    notices: info.notices,
    folderChosen: info.notesDir !== '',
    // First run is "nothing has happened yet", not "the folder is empty": a user with an empty
    // folder who has already spoken is past the explanation and should not be shown it again.
    firstRun: !everTalked && turns.length === 0 && notes.length === 0,
    speakable,
    beginHold,
    endHold,
    dismiss,
    cancel,
    speak,
  }
}

/** `14:32` — the design times each turn, and the clock is the user's own. */
function clockTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
