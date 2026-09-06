/**
 * The turn is the whole product, and it is a state machine (`docs/PLAN.md` §2). Everything in
 * this file is plain TypeScript: no Electron, no Node, no browser. That is what makes the flow
 * testable without any of them.
 */

/** A hold shorter than this is an accidental tap, and is discarded before anything downstream runs. */
export const MIN_HOLD_MS = 250

/**
 * Why a tagged union and not four booleans: `isRecording && !isTranscribing` invites a state
 * that must not exist. This makes "recording while thinking" unrepresentable, and gives the UI
 * one value to render rather than a combination to interpret.
 */
export type TurnState =
  | { k: 'idle' }
  | { k: 'recording'; startedAt: number; level: number }
  | { k: 'transcribing' }
  | { k: 'thinking' }
  | { k: 'speaking' }
  | { k: 'error'; failure: TurnFailure }

/**
 * Failures cross every boundary as data, never as a thrown `Error`, so the interface can tell
 * "your machine needs fixing" from "this turn failed" (`docs/PLAN.md` §7 and §5.6).
 *
 * `setup` covers the four things the app cannot proceed without and cannot fix itself. Note
 * `agent-auth`: a CLI that is installed but never signed in is a *setup* problem with an exact
 * fix, and reporting it as an agent failure would send the user to debug the wrong thing.
 */
export type TurnFailure =
  | { kind: 'mic-denied'; permanent: boolean }
  | { kind: 'setup'; what: 'agent-cli' | 'agent-auth' | 'whisper' | 'model'; hint: string }
  | { kind: 'agent-failed'; stderr: string }
  | { kind: 'timeout'; afterMs: number }
  | { kind: 'empty-speech' }

/** The result channel for everything that can fail: success or a typed failure, never a throw. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: TurnFailure }

export function succeeded<T>(value: T): Outcome<T> {
  return { ok: true, value }
}

export function failed<T>(failure: TurnFailure): Outcome<T> {
  return { ok: false, failure }
}

/** Everything that can move the turn along. Anything not listed here cannot change the state. */
export type TurnEvent =
  | { t: 'hold-started'; at: number }
  | { t: 'hold-ended'; at: number }
  | { t: 'level-changed'; level: number }
  | { t: 'transcribed' }
  | { t: 'replied'; spoken: boolean }
  | { t: 'finished-speaking' }
  | { t: 'failed'; failure: TurnFailure }
  | { t: 'dismissed' }

/**
 * The machine, as a pure function. Every unhandled (state, event) pair returns the state
 * unchanged, which is how the rules below are enforced rather than merely documented:
 *
 * - a hold starts a recording ONLY from `idle`, so an auto-repeating key held down produces one
 *   recording instead of a new one per repeat;
 * - a hold shorter than `MIN_HOLD_MS` returns to `idle` and never reaches transcription;
 * - a second hold while the turn is busy is refused by the state, not queued.
 */
export function nextTurnState(state: TurnState, event: TurnEvent): TurnState {
  switch (event.t) {
    case 'hold-started':
      // Ignored unless idle. This single guard is what makes key repeat a no-op.
      return state.k === 'idle' ? { k: 'recording', startedAt: event.at, level: 0 } : state

    case 'hold-ended':
      if (state.k !== 'recording') return state
      return event.at - state.startedAt < MIN_HOLD_MS ? { k: 'idle' } : { k: 'transcribing' }

    case 'level-changed':
      return state.k === 'recording' ? { ...state, level: event.level } : state

    case 'transcribed':
      return state.k === 'transcribing' ? { k: 'thinking' } : state

    case 'replied':
      if (state.k !== 'thinking') return state
      return event.spoken ? { k: 'speaking' } : { k: 'idle' }

    case 'finished-speaking':
      return state.k === 'speaking' ? { k: 'idle' } : state

    case 'failed':
      return { k: 'error', failure: event.failure }

    case 'dismissed':
      return state.k === 'error' ? { k: 'idle' } : state
  }
}
