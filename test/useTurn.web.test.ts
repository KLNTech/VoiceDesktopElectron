import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MIN_HOLD_MS } from '../src/domain/model/turn'
import type { AudioClip } from '../src/domain/model/audio-clip'
import type { Outcome } from '../src/domain/model/turn'

/**
 * The hook that ties the machine to the microphone and the bridge — the report's second blocker,
 * B2: `useTurn.ts` had no test at all, in a file that had already shipped one invisible
 * regression, and `@testing-library/react` and `jsdom` sat in devDependencies imported by not one
 * file in the repository.
 *
 * The defect this suite is shaped around: a rejected bridge call left the turn SUSPENDED. The
 * state machine simply never received another event, so the window sat in "transcribing" for
 * ever, with no error anywhere and every unit test green — that is how a preload that never
 * loaded presented to a user.
 */

/** The microphone, without a microphone: every branch of `start`/`stop` under the test's control. */
class FakeRecorder {
  static instances: FakeRecorder[] = []
  static startOutcome: Outcome<void> = { k: 'ok', value: undefined }
  /** Held open until the test resolves it, so "released while starting" is reproducible. */
  static blockStart: (() => void) | null = null

  released = 0
  stopped = 0
  startedAtMs = 1_000
  clip: AudioClip = { samples: new Float32Array(16), sampleRate: 16_000, heldMs: 900 }

  constructor() {
    FakeRecorder.instances.push(this)
  }

  async start(): Promise<Outcome<void>> {
    if (FakeRecorder.blockStart !== null) {
      await new Promise<void>((resolve) => {
        FakeRecorder.blockStart = resolve
      })
    }
    return FakeRecorder.startOutcome
  }
  async stop(): Promise<AudioClip> {
    this.stopped += 1
    return this.clip
  }
  async release(): Promise<void> {
    this.released += 1
  }
  level(): number {
    return 0
  }
}

vi.mock('../src/renderer/src/audio/recorder', () => ({ MicrophoneRecorder: FakeRecorder }))

const { useTurn } = await import('../src/renderer/src/useTurn')

/** Every bridge method, each replaceable per test — the renderer's whole outside world. */
function bridge(overrides: Record<string, unknown> = {}): void {
  Reflect.set(window, 'voicedesk', {
    appInfo: async () => ({
      version: '0.0.0',
      stage: 'dev',
      notesDir: '/tmp/notes',
      agentModel: 'haiku',
      notices: [],
    }),
    notes: async () => ({ files: [] }),
    transcribe: async () => ({ k: 'ok', value: { text: 'add milk', heldMs: 900 } }),
    ask: async () => ({
      k: 'ok',
      value: {
        reply: 'Added milk to shopping.md',
        notes: [{ name: 'shopping.md', status: 'edited' }],
        model: 'claude-haiku-4-5',
        sessionId: 'session-1',
        costUsd: 0.001,
      },
    }),
    speak: async () => ({ k: 'ok', value: null }),
    micAccess: async () => 'granted',
    openSettings: async () => undefined,
    ...overrides,
  })
}

beforeEach(() => {
  FakeRecorder.instances = []
  FakeRecorder.startOutcome = { k: 'ok', value: undefined }
  FakeRecorder.blockStart = null
  bridge()
})
afterEach(() => Reflect.deleteProperty(window, 'voicedesk'))

/** Presses and releases the control, and waits for the turn to settle. */
async function hold(turn: { current: ReturnType<typeof useTurn> }): Promise<void> {
  await act(async () => turn.current.beginHold())
  await act(async () => turn.current.endHold())
}

describe('one whole turn', () => {
  it('records, transcribes, asks and lands back at rest', async () => {
    const { result } = renderHook(() => useTurn())
    await waitFor(() => expect(result.current.notesDir).toBe('/tmp/notes'))

    await act(async () => result.current.beginHold())
    expect(result.current.state.k).toBe('recording')

    await act(async () => result.current.endHold())
    await waitFor(() => expect(result.current.state.k).toBe('idle'))

    expect(result.current.turns).toHaveLength(1)
    expect(result.current.turns[0]?.you).toBe('add milk')
    expect(result.current.turns[0]?.agent).toBe('Added milk to shopping.md')
    expect(result.current.notes.map((note) => note.name)).toEqual(['shopping.md'])
  })

  it('shows the transcript before the agent has answered', async () => {
    // Two promises, so the assertion happens while the agent is still thinking. Showing someone
    // their own words is a separate promise from answering them (`docs/PLAN.md` §7).
    let answer: (() => void) | null = null
    bridge({
      ask: async () => {
        await new Promise<void>((resolve) => {
          answer = resolve
        })
        return { k: 'ok', value: { reply: 'done', notes: [], model: 'm', sessionId: null, costUsd: null } }
      },
    })
    const { result } = renderHook(() => useTurn())

    await act(async () => result.current.beginHold())
    await act(async () => result.current.endHold())
    await waitFor(() => expect(result.current.state.k).toBe('thinking'))

    expect(result.current.turns[0]?.you).toBe('add milk')
    expect(result.current.turns[0]?.agent).toBeNull()

    await act(async () => {
      answer?.()
    })
  })

  it('carries the session id, so two turns are one conversation', async () => {
    const asked: (string | null)[] = []
    bridge({
      ask: async (request: { sessionId: string | null }) => {
        asked.push(request.sessionId)
        return {
          k: 'ok',
          value: { reply: 'ok', notes: [], model: 'm', sessionId: 'session-1', costUsd: null },
        }
      },
    })
    const { result } = renderHook(() => useTurn())

    await hold(result)
    await waitFor(() => expect(result.current.state.k).toBe('idle'))
    await hold(result)
    await waitFor(() => expect(result.current.turns).toHaveLength(2))

    expect(asked).toEqual([null, 'session-1'])
  })
})

describe('when something breaks', () => {
  /**
   * The regression this whole file exists for.
   */
  it('never leaves the turn suspended when a bridge call rejects', async () => {
    bridge({
      transcribe: async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'transcribe')")
      },
    })
    const { result } = renderHook(() => useTurn())

    await hold(result)

    // Not "still transcribing". The machine received an event and the user was told something.
    await waitFor(() => expect(result.current.state.k).toBe('error'))
    expect(result.current.state).toMatchObject({ failure: { kind: 'transcribe-failed' } })
  })

  it('releases the microphone when the turn fails mid-flight', async () => {
    bridge({
      ask: async () => {
        throw new Error('the agent process vanished')
      },
    })
    const { result } = renderHook(() => useTurn())

    await hold(result)
    await waitFor(() => expect(result.current.state.k).toBe('error'))

    // The macOS recording indicator staying lit after a failed turn is how a user stops trusting
    // an app that listens.
    expect(FakeRecorder.instances[0]?.released).toBeGreaterThan(0)
  })

  it('surfaces a refused microphone as an error the user can act on', async () => {
    FakeRecorder.startOutcome = {
      k: 'failed',
      failure: { kind: 'mic-denied', denial: 'system-settings' },
    }
    const { result } = renderHook(() => useTurn())

    await act(async () => result.current.beginHold())

    expect(result.current.state).toMatchObject({
      k: 'error',
      failure: { kind: 'mic-denied', denial: 'system-settings' },
    })
  })

  /**
   * `'...'`, not `'  '`, and the difference is the whole assertion.
   *
   * Whisper answers a silent clip with the punctuation-only fragments it hallucinates from
   * noise, and the domain's `isEmpty` strips punctuation before deciding. A renderer comparing
   * `text === ''` — which this once did — passes those straight to the agent as a real turn, and
   * `'  '` would not tell the two apart because it trims to the empty string either way.
   */
  it('calls a punctuation-only hallucination empty, rather than sending it to the agent', async () => {
    let asked = 0
    bridge({
      transcribe: async () => ({ k: 'ok', value: { text: ' ... ', heldMs: 900 } }),
      ask: async () => {
        asked += 1
        return { k: 'ok', value: { reply: '', notes: [], model: 'm', sessionId: null, costUsd: null } }
      },
    })
    const { result } = renderHook(() => useTurn())

    await hold(result)

    await waitFor(() => expect(result.current.state).toMatchObject({ failure: { kind: 'empty-speech' } }))
    expect(asked).toBe(0)
  })

  it('withdraws the speak control when the voice will not start, and keeps the reply', async () => {
    bridge({ speak: async () => ({ k: 'failed', failure: { kind: 'agent-failed', stderr: 'no say' } }) })
    const { result } = renderHook(() => useTurn())

    await hold(result)
    await waitFor(() => expect(result.current.turns).toHaveLength(1))
    await act(async () => result.current.speak('Added milk'))

    await waitFor(() => expect(result.current.speakable).toBe(false))
    // A voice that will not start is never a failed turn: the answer is already on screen.
    expect(result.current.state.k).toBe('idle')
    expect(result.current.turns[0]?.agent).toBe('Added milk to shopping.md')
  })
})

describe('the rules the machine owns', () => {
  it('discards a tap under the minimum and says so quietly', async () => {
    const { result } = renderHook(() => useTurn())
    await act(async () => result.current.beginHold())
    const recorder = FakeRecorder.instances[0]
    if (recorder === undefined) throw new Error('the hold started no recorder')
    recorder.clip = { ...recorder.clip, heldMs: MIN_HOLD_MS - 1 }

    await act(async () => result.current.endHold())

    expect(result.current.notice).toBe('tooShort')
    expect(result.current.turns).toHaveLength(0)
    expect(result.current.state.k).toBe('idle')
  })

  it('refuses a second hold while the first turn is still working', async () => {
    let answer: (() => void) | null = null
    bridge({
      ask: async () => {
        await new Promise<void>((resolve) => {
          answer = resolve
        })
        return { k: 'ok', value: { reply: 'ok', notes: [], model: 'm', sessionId: null, costUsd: null } }
      },
    })
    const { result } = renderHook(() => useTurn())

    await hold(result)
    await waitFor(() => expect(result.current.state.k).toBe('thinking'))

    await act(async () => result.current.beginHold())

    expect(result.current.state.k).toBe('thinking')
    expect(FakeRecorder.instances).toHaveLength(1)
    await act(async () => {
      answer?.()
    })
  })

  /**
   * B1, kept red-able. The permission prompt alone takes seconds the first time, and a user who
   * lets go during it used to have the release dropped by the state guard — leaving the
   * microphone open with the interface back at rest.
   */
  it('honours a release that arrives while the microphone is still opening', async () => {
    FakeRecorder.blockStart = (): void => undefined
    const { result } = renderHook(() => useTurn())

    await act(async () => result.current.beginHold())
    expect(result.current.state.k).toBe('idle') // not recording yet: `start()` has not returned

    await act(async () => result.current.endHold())
    await act(async () => {
      FakeRecorder.blockStart?.()
      await Promise.resolve()
    })

    await waitFor(() => expect(FakeRecorder.instances[0]?.released).toBe(1))
    expect(result.current.state.k).toBe('idle')
  })
})
