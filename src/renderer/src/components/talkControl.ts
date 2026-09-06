import type { TurnState } from '../../../domain/model/turn'

/**
 * What the control is doing, as one value.
 *
 * This replaced a pair of booleans (`recording` + `busy`). Two flags naming phases of the same
 * process allow `recording && busy` — a combination that must never happen, but which the type
 * permitted, so every reader had to prove to themselves it did not occur. One state makes it
 * unrepresentable, and `switch` forces each case to be answered.
 */
export type TalkControl = 'ready' | 'recording' | 'busy'

/** The single mapping from the turn to the control, so no caller can invent a fourth answer. */
export function talkControl(state: TurnState): TalkControl {
  switch (state.k) {
    case 'recording':
      return 'recording'
    case 'transcribing':
    case 'thinking':
    case 'speaking':
      return 'busy'
    case 'idle':
    case 'error':
      return 'ready'
  }
}
