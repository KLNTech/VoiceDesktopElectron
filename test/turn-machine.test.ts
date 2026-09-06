import { describe, expect, it } from 'vitest'

import { MIN_HOLD_MS, nextTurnState, type TurnState } from '../src/domain/model/turn'

const idle: TurnState = { k: 'idle' }

describe('the turn machine', () => {
  it('starts recording on a hold', () => {
    expect(nextTurnState(idle, { t: 'hold-started', at: 1_000 })).toEqual({
      k: 'recording',
      startedAt: 1_000,
      level: 0,
    })
  })

  it('ignores key repeat: a second hold does not restart the recording', () => {
    const recording = nextTurnState(idle, { t: 'hold-started', at: 1_000 })
    const repeated = nextTurnState(recording, { t: 'hold-started', at: 1_030 })
    // Same object, same startedAt — an auto-repeating key produces one recording, not thirty.
    expect(repeated).toBe(recording)
  })

  it('discards a hold shorter than the minimum and returns to idle', () => {
    const recording = nextTurnState(idle, { t: 'hold-started', at: 1_000 })
    const ended = nextTurnState(recording, { t: 'hold-ended', at: 1_000 + MIN_HOLD_MS - 1 })
    expect(ended).toEqual({ k: 'idle' })
  })

  it('transcribes a hold that reaches the minimum', () => {
    const recording = nextTurnState(idle, { t: 'hold-started', at: 1_000 })
    const ended = nextTurnState(recording, { t: 'hold-ended', at: 1_000 + MIN_HOLD_MS })
    expect(ended).toEqual({ k: 'transcribing' })
  })

  it('refuses a hold while the turn is busy rather than queueing it', () => {
    for (const busy of [
      { k: 'transcribing' },
      { k: 'thinking' },
      { k: 'speaking' },
    ] satisfies TurnState[]) {
      expect(nextTurnState(busy, { t: 'hold-started', at: 9_999 })).toBe(busy)
    }
  })

  it('tracks the level only while recording', () => {
    const recording = nextTurnState(idle, { t: 'hold-started', at: 1_000 })
    expect(nextTurnState(recording, { t: 'level-changed', level: 0.4 })).toMatchObject({
      k: 'recording',
      level: 0.4,
    })
    expect(nextTurnState(idle, { t: 'level-changed', level: 0.4 })).toBe(idle)
  })

  it('goes to idle after a reply that is not spoken, and to speaking when it is', () => {
    const thinking: TurnState = { k: 'thinking' }
    expect(nextTurnState(thinking, { t: 'replied', spoken: false })).toEqual({ k: 'idle' })
    expect(nextTurnState(thinking, { t: 'replied', spoken: true })).toEqual({ k: 'speaking' })
  })

  it('can fail from any state, and only an error can be dismissed', () => {
    const failure = { kind: 'timeout', afterMs: 90_000 } as const
    expect(nextTurnState({ k: 'thinking' }, { t: 'failed', failure })).toEqual({
      k: 'error',
      failure,
    })
    expect(nextTurnState({ k: 'error', failure }, { t: 'dismissed' })).toEqual({ k: 'idle' })
    expect(nextTurnState(idle, { t: 'dismissed' })).toBe(idle)
  })
})
