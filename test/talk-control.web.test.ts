import { describe, expect, it } from 'vitest'

import type { TurnState } from '../src/domain/model/turn'
import { talkControl } from '../src/renderer/src/components/talkControl'

/**
 * The control used to take two booleans, `recording` and `busy`, which between them could
 * express `recording && busy` — a state that must never exist. These check that the single
 * mapping answers every turn state, and answers each exactly once.
 */
const everyState: TurnState[] = [
  { k: 'idle' },
  { k: 'recording', startedAt: 0, level: 0 },
  { k: 'transcribing' },
  { k: 'thinking' },
  { k: 'speaking' },
  { k: 'error', failure: { kind: 'empty-speech' } },
]

describe('talkControl', () => {
  it('answers every turn state with exactly one control state', () => {
    for (const state of everyState) {
      expect(['ready', 'recording', 'busy']).toContain(talkControl(state))
    }
  })

  it('is recording only while recording', () => {
    const recordingStates = everyState.filter((s) => talkControl(s) === 'recording')
    expect(recordingStates.map((s) => s.k)).toEqual(['recording'])
  })

  it('disables the control for every state where a hold would be refused anyway', () => {
    // These are exactly the states in which the turn machine ignores `hold-started`, so the
    // control being disabled and the machine refusing the hold cannot drift apart.
    const busy = everyState.filter((s) => talkControl(s) === 'busy').map((s) => s.k)
    expect(busy).toEqual(['transcribing', 'thinking', 'speaking'])
  })

  it('offers the control again after a failure, so an error is not a dead end', () => {
    expect(talkControl({ k: 'error', failure: { kind: 'no-microphone' } })).toBe('ready')
  })
})
