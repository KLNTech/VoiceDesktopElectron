/**
 * The turn is the whole product, and it is a state machine (`docs/PLAN.md` §2). Everything in
 * this file is plain TypeScript: no Electron, no Node, no browser. That is what makes the flow
 * testable without any of them.
 */

/** A hold shorter than this is an accidental tap, and is discarded before anything downstream runs. */
export const MIN_HOLD_MS = 250

/**
 * A hold longer than this is ended for the user, and the turn proceeds with what was said.
 *
 * Without a ceiling the recording is bounded only by whatever stops the hold — and nothing has
 * to. A key that repeats into a wedged window, a pointer capture that never sees its release, a
 * user who walks away: each accumulates Float32 for as long as it lasts, at 64 KB per second at
 * 16 kHz and three times that from a 48 kHz device.
 *
 * The size check that existed was in the IPC schema, which is far too late twice over. It runs
 * AFTER the whole buffer has been concatenated into one allocation, so the memory has already
 * been spent by the time it is refused; and it answers with a rejected payload, so a long hold
 * ends by throwing away everything the user said rather than by transcribing the first two
 * minutes of it. Ending the hold is the better failure: it is the same thing the user would
 * have done, done on time.
 *
 * Two minutes because that is what 8 MB is at 16 kHz — the bound the wire already declared —
 * and because no spoken instruction to a note-taking agent is longer.
 */
export const MAX_HOLD_MS = 120_000

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
  | { kind: 'mic-denied'; denial: MicDenial }
  | { kind: 'no-microphone' }
  | { kind: 'setup'; what: 'agent-cli' | 'agent-auth' | 'whisper' | 'model'; hint: string }
  | { kind: 'transcribe-failed'; stderr: string }
  | { kind: 'agent-failed'; stderr: string }
  | { kind: 'timeout'; afterMs: number }
  | { kind: 'empty-speech' }

/**
 * The result channel for everything that can fail: success or a typed failure, never a throw.
 *
 * Tagged like `TurnState` rather than discriminated on a boolean. A boolean would fix this at
 * exactly two outcomes, and the turn already has a third in view: `Esc` cancels, and cancelled
 * is not broken. With `ok: false` the only home for a cancellation is "a kind of failure",
 * which is the same collapsing of distinguishable outcomes this codebase refuses everywhere
 * else.
 */
/**
 * How a microphone refusal can be fixed, which is the only thing the user needs from it.
 * `docs/PLAN.md` §6 describes three permission outcomes; granted is not a failure, so the two
 * denials live here. A boolean called `permanent` said the same thing while hiding what to DO
 * about it, and could not grow a third case (a device held by another app, say).
 */
export type MicDenial =
  /** The prompt was dismissed, or not answered. Holding again can still succeed. */
  | 'retryable'
  /** macOS has recorded a denial. Nothing in the app can undo it; only System Settings can. */
  | 'system-settings'

/**
 * What became of the spoken reply. `spoken: boolean` collapsed two different things into
 * `false` — nobody asked for speech, and speech was asked for and could not be produced — and
 * the interface needs to tell them apart to know whether to offer a replay control.
 */
export type SpeechOutcome = 'spoken' | 'not-requested' | 'unavailable'

export type Outcome<T> = { k: 'ok'; value: T } | { k: 'failed'; failure: TurnFailure }

export function succeeded<T>(value: T): Outcome<T> {
  return { k: 'ok', value }
}

export function failed<T>(failure: TurnFailure): Outcome<T> {
  return { k: 'failed', failure }
}

/** Everything that can move the turn along. Anything not listed here cannot change the state. */
export type TurnEvent =
  | { t: 'hold-started'; at: number }
  | { t: 'hold-ended'; at: number }
  /** The hold reached `MAX_HOLD_MS` and was ended for the user rather than by them. */
  | { t: 'hold-capped' }
  | { t: 'level-changed'; level: number }
  | { t: 'transcribed' }
  | { t: 'replied'; speech: SpeechOutcome }
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
 * - a hold that reaches `MAX_HOLD_MS` is ended here rather than left to whatever was going to
 *   stop it, which may be nothing;
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

    case 'hold-capped':
      // Reaching the ceiling is a completed hold, not a failure: the turn goes on to
      // transcription with what was captured. It cannot be under MIN_HOLD_MS by construction.
      return state.k === 'recording' ? { k: 'transcribing' } : state

    case 'level-changed':
      return state.k === 'recording' ? { ...state, level: event.level } : state

    case 'transcribed':
      return state.k === 'transcribing' ? { k: 'thinking' } : state

    case 'replied':
      if (state.k !== 'thinking') return state
      return event.speech === 'spoken' ? { k: 'speaking' } : { k: 'idle' }

    case 'finished-speaking':
      return state.k === 'speaking' ? { k: 'idle' } : state

    case 'failed':
      return { k: 'error', failure: event.failure }

    case 'dismissed':
      return state.k === 'error' ? { k: 'idle' } : state

    default: {
      // Add an event and every switch missing it fails to compile — a refactor the compiler
      // drives rather than one someone remembers to do.
      const unhandled: never = event
      throw new Error(`unhandled turn event: ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * Whether a recording has reached its ceiling, as a pure predicate.
 *
 * Here rather than in the renderer's effect so the rule is one value the machine and the
 * interface agree on, and so it is testable without a microphone.
 */
export function holdExceeded(state: TurnState, now: number): boolean {
  return state.k === 'recording' && now - state.startedAt >= MAX_HOLD_MS
}
