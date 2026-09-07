import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  classifyMicError,
  concat,
  denialKind,
  MicrophoneRecorder,
} from '../src/renderer/src/audio/recorder'

/**
 * The recorder's own branches, none of which had a test — the report's M18.
 *
 * `stop()` posts `'flush'` to the worklet and races the `'done'` reply against a hard-coded
 * 250 ms timeout. Neither branch was exercised, and the textbook failures of that shape are a
 * silent hang and silent data loss. Nothing here needs Web Audio or a device: the worklet node
 * is a fake port, and the timer is Vitest's.
 */
vi.mock('../src/renderer/src/audio/pcm-worklet.js?url', () => ({ default: 'worklet.js' }))

/** The one thing `stop()` talks to: a port that may or may not answer, and may take its time. */
class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null
  posted: unknown[] = []
  closed = false

  /** How the real worklet answers a flush: any tail samples, then `'done'`. */
  answerWith: 'done' | 'tail-then-done' | 'silence' = 'done'

  postMessage(message: unknown): void {
    this.posted.push(message)
    if (this.answerWith === 'silence') return
    if (this.answerWith === 'tail-then-done') {
      this.onmessage?.({ data: new Float32Array([0.5, 0.5]) })
    }
    this.onmessage?.({ data: 'done' })
  }
  close(): void {
    this.closed = true
  }
}

/**
 * Puts a fake worklet node and context into a real recorder.
 *
 * The private fields are reached through `Reflect` rather than a cast: `start()` needs
 * `getUserMedia`, an `AudioContext` and an `AudioWorklet`, none of which jsdom has, and building
 * four fakes to reach one `await` would test the fakes.
 */
function recorderWithPort(port: FakePort, chunks: Float32Array[] = []): MicrophoneRecorder {
  const recorder = new MicrophoneRecorder()
  Reflect.set(recorder, 'node', { port, disconnect: (): void => {} })
  Reflect.set(recorder, 'context', { sampleRate: 16_000, state: 'running', close: async (): Promise<void> => {} })
  Reflect.set(recorder, 'chunks', chunks)
  Reflect.set(recorder, 'startedAt', performance.now())
  return recorder
}

describe('ending a hold', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }))
  afterEach(() => vi.useRealTimers())

  it('asks the worklet to flush', async () => {
    const port = new FakePort()
    await recorderWithPort(port).stop()
    expect(port.posted).toEqual(['flush'])
  })

  /**
   * The tail is FORWARDED, not swallowed — which is the whole reason `stop()` waits at all.
   *
   * `stop()` replaces the port's `onmessage` for the length of the flush, so it owns one
   * contract: resolve on `'done'`, and hand every other message to the handler that was already
   * there. Miss the second half and the worklet's final samples — the end of the user's
   * sentence — are dropped by the very code that asked for them.
   *
   * The spy stands in for the collector `start()` installs, so this asserts the forwarding
   * rather than re-testing the collector.
   */
  it('forwards the tail to the handler that was already listening', async () => {
    const port = new FakePort()
    port.answerWith = 'tail-then-done'
    const collected: unknown[] = []
    port.onmessage = (event): void => {
      collected.push(event.data)
    }

    await recorderWithPort(port).stop()

    expect(collected).toHaveLength(1)
    const tail = collected[0]
    if (!(tail instanceof Float32Array)) throw new Error(`the tail was not samples: ${String(tail)}`)
    expect(Array.from(tail)).toEqual([0.5, 0.5])
  })

  it('returns everything captured before the flush', async () => {
    // Values exactly representable in Float32, so this asserts the joining rather than binary32.
    const port = new FakePort()
    const clip = await recorderWithPort(port, [
      new Float32Array([0.25]),
      new Float32Array([0.5]),
    ]).stop()
    expect(Array.from(clip.samples)).toEqual([0.25, 0.5])
  })

  it('resolves without waiting the full 250 ms when the worklet answers', async () => {
    const port = new FakePort()
    const stopped = recorderWithPort(port).stop()
    // No timer is advanced at all. If `stop()` waited for the timeout rather than the reply,
    // this would hang and the test would time out rather than fail with a message.
    await expect(stopped).resolves.toBeDefined()
  })

  /**
   * The branch that keeps the app alive: a worklet that never answers.
   */
  it('gives up after 250 ms rather than hanging on a silent worklet', async () => {
    const port = new FakePort()
    port.answerWith = 'silence'
    const stopped = recorderWithPort(port, [new Float32Array([0.75])]).stop()

    await vi.advanceTimersByTimeAsync(250)

    const clip = await stopped
    // What was already captured is still returned: a silent worklet costs the tail, not the turn.
    expect(Array.from(clip.samples)).toEqual([0.75])
  })

  it('releases the device even when the worklet never answers', async () => {
    const port = new FakePort()
    port.answerWith = 'silence'
    const stopped = recorderWithPort(port).stop()
    await vi.advanceTimersByTimeAsync(250)
    await stopped

    expect(port.closed).toBe(true)
  })

  it('reports the hold on the recorder’s own clock', async () => {
    const port = new FakePort()
    const recorder = recorderWithPort(port)
    Reflect.set(recorder, 'startedAt', performance.now() - 1_500)

    const clip = await recorder.stop()

    expect(clip.heldMs).toBeGreaterThanOrEqual(1_500)
    expect(clip.sampleRate).toBe(16_000)
  })
})

describe('joining the captured chunks', () => {
  it('concatenates in order', () => {
    const joined = concat([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])])
    expect(Array.from(joined)).toEqual([1, 2, 3, 4, 5])
  })

  it('returns an empty buffer for no chunks, rather than throwing', () => {
    // The hold that captured nothing is an ordinary outcome — a tap, or a muted device — and it
    // has to reach `isEmpty` as a transcript, not as an exception here.
    expect(concat([])).toHaveLength(0)
  })
})

const domException = (name: string): DOMException => new DOMException('denied', name)

describe('telling the user which microphone problem they have', () => {
  it.each([['NotFoundError'], ['DevicesNotFoundError'], ['OverconstrainedError']])(
    'reads %s as "there is no device"',
    async (name) => {
      expect(await classifyMicError(domException(name))).toEqual({ kind: 'no-microphone' })
    },
  )

  it.each([['NotAllowedError'], ['SecurityError']])('reads %s as a denial', async (name) => {
    expect(await classifyMicError(domException(name))).toMatchObject({ kind: 'mic-denied' })
  })

  it('does not file an unrecognised failure as a denial', () => {
    // Collapsing these sends someone to a settings pane about a problem that is not permissions.
    return expect(classifyMicError(new Error('the audio pipeline exploded'))).resolves.toMatchObject({
      kind: 'transcribe-failed',
    })
  })
})

/** The only bridge method `denialKind` reaches for. */
const withBridge = (micAccess: () => Promise<string>): void => {
  Reflect.set(window, 'voicedesk', { micAccess })
}

describe('which denial it is', () => {
  afterEach(() => Reflect.deleteProperty(window, 'voicedesk'))

  it('sends the user to System Settings when macOS says denied', async () => {
    withBridge(async () => 'denied')
    expect(await denialKind()).toBe('system-settings')
  })

  it('treats a restricted device the same way', async () => {
    // Managed devices: the user cannot grant it from the page either, and the pane is where the
    // explanation lives.
    withBridge(async () => 'restricted')
    expect(await denialKind()).toBe('system-settings')
  })

  it('lets the user retry when macOS has never been asked', async () => {
    withBridge(async () => 'not-determined')
    expect(await denialKind()).toBe('retryable')
  })

  /**
   * The behaviour that was wrong before the OS was consulted at all.
   *
   * Chromium can report `granted` for its own per-origin permission while macOS has the
   * microphone switched off for the whole app — they are answers to different questions.
   */
  it('believes macOS over the page', async () => {
    withBridge(async () => 'denied')
    Reflect.set(navigator, 'permissions', { query: async () => ({ state: 'granted' }) })
    expect(await denialKind()).toBe('system-settings')
  })

  it('falls back to the page when the bridge cannot answer', async () => {
    withBridge(async () => {
      throw new Error('bridge is gone')
    })
    Reflect.set(navigator, 'permissions', { query: async () => ({ state: 'denied' }) })
    expect(await denialKind()).toBe('system-settings')
  })

  it('says retryable when neither side can answer', async () => {
    // Not evidence of a recorded denial. It costs the user one retry instead of a wasted trip.
    withBridge(async () => {
      throw new Error('bridge is gone')
    })
    Reflect.set(navigator, 'permissions', {
      query: async () => {
        throw new Error('unsupported')
      },
    })
    expect(await denialKind()).toBe('retryable')
  })
})
