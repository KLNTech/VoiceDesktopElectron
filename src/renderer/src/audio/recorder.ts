import type { MicDenial, Outcome, TurnFailure } from '../../../domain/model/turn'
import type { AudioClip } from '../../../domain/model/audio-clip'
import workletUrl from './pcm-worklet.js?url'

/**
 * What one hold produced. This IS the domain's `AudioClip` — it was a second, field-for-field
 * identical declaration, which is a copy that agrees today and has no reason to keep agreeing.
 */
export type CapturedClip = AudioClip

/**
 * Starting the microphone succeeds or fails, in the app's one result vocabulary.
 *
 * It was written out as `{ k: 'ok' } | { k: 'failed'; failure: TurnFailure }` — branch for
 * branch, `Outcome<void>` — in a file that already imported from `domain/model/turn` on line
 * one. `Outcome`'s own comment names what the copy costs: the turn has a third outcome in view,
 * because `Esc` cancels and cancelled is not broken, and a hand-written union does not receive
 * that case when it is added.
 */
export type StartResult = Outcome<void>

/**
 * The most audio one hold may accumulate, whatever the device's rate.
 *
 * 8 MB is the bound `shared/ipc.ts` already declares for the wire, and a Float32 sample is four
 * bytes, so this is that same limit expressed where it can actually be enforced — before the
 * memory is spent, rather than after `concat` has built one allocation out of everything and
 * the schema refuses the result.
 */
const MAX_SAMPLES = (8 * 1024 * 1024) / Float32Array.BYTES_PER_ELEMENT

/** 16 kHz is asked for as an optimisation, not required — whisper resamples (`docs/PLAN.md` §6). */
const PREFERRED_RATE = 16_000

/**
 * Owns the microphone for the length of one hold, and nothing longer.
 *
 * The stream is acquired on the FIRST hold, never at startup: asking for the microphone before
 * the user has pressed anything reads as spyware and burns the single prompt macOS gives. Every
 * exit path releases the tracks — if it does not, the macOS recording indicator stays lit after
 * the app has stopped listening, and a user who notices that stops trusting the app.
 */
export class MicrophoneRecorder {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private analyser: AnalyserNode | null = null
  private chunks: Float32Array[] = []
  /** Samples accepted so far, so the ceiling costs one addition rather than a walk per batch. */
  private captured = 0
  private startedAt = 0

  /** When the hold began, on the recorder's clock — the one `heldMs` is measured against. */
  get startedAtMs(): number {
    return this.startedAt
  }
  private meterBuffer = new Float32Array(1_024)

  async start(): Promise<StartResult> {
    this.chunks = []
    this.captured = 0
    this.startedAt = performance.now()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (error) {
      return { k: 'failed', failure: await classifyMicError(error) }
    }

    this.stream = stream
    try {
      this.context = makeContext()
      await this.context.audioWorklet.addModule(workletUrl)

      const source = this.context.createMediaStreamSource(stream)
      this.node = new AudioWorkletNode(this.context, 'pcm-collector')
      this.node.port.onmessage = (event: MessageEvent<Float32Array | 'done'>) => {
        if (event.data === 'done') return
        // The hard ceiling, in SAMPLES rather than milliseconds, and the reason both exist.
        // `MAX_HOLD_MS` is the product rule and it depends on the turn machine still running;
        // this one depends on nothing. A 48 kHz device fills three times faster than the 16 kHz
        // the cap was reasoned about, and an effect that stopped scheduling — a wedged window,
        // a backgrounded tab — stops enforcing time while audio keeps arriving here.
        //
        // The TAIL is dropped, not the head: what someone said first is the part they meant.
        if (this.captured + event.data.length > MAX_SAMPLES) return
        this.captured += event.data.length
        this.chunks.push(event.data)
      }

      // The meter reads from its own node. It changes ~30 times a second and only the meter
      // consumes it, so it never crosses a process boundary (`docs/PLAN.md` §3, figure 2).
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = 2_048

      source.connect(this.node)
      source.connect(this.analyser)
      return { k: 'ok', value: undefined }
    } catch (error) {
      await this.release()
      return {
        k: 'failed',
        failure: { kind: 'transcribe-failed', stderr: `audio pipeline: ${String(error)}` },
      }
    }
  }

  /** Current loudness, 0..1. The only evidence the user has that the microphone is live. */
  level(): number {
    if (this.analyser === null) return 0
    this.analyser.getFloatTimeDomainData(this.meterBuffer)
    let sum = 0
    for (const sample of this.meterBuffer) sum += sample * sample
    const rms = Math.sqrt(sum / this.meterBuffer.length)
    // Perceptual rather than linear: a linear meter looks dead for ordinary speech.
    return Math.min(1, Math.sqrt(rms) * 2.2)
  }

  /** Ends the hold and returns everything captured. Always releases the device. */
  async stop(): Promise<CapturedClip> {
    const heldMs = performance.now() - this.startedAt
    const sampleRate = this.context?.sampleRate ?? PREFERRED_RATE

    if (this.node !== null) {
      const flushed = new Promise<void>((resolve) => {
        const port = this.node?.port
        if (port === undefined) return resolve()
        const previous = port.onmessage
        port.onmessage = (event: MessageEvent<Float32Array | 'done'>) => {
          if (event.data === 'done') return resolve()
          previous?.call(port, event)
        }
        port.postMessage('flush')
        // The tail is worth waiting for, but never worth hanging on.
        setTimeout(resolve, 250)
      })
      await flushed
    }

    await this.release()
    return { samples: concat(this.chunks), sampleRate, heldMs }
  }

  /** Releases the microphone. Safe to call twice; called on every failure path. */
  async release(): Promise<void> {
    this.node?.port.close()
    this.node?.disconnect()
    this.analyser?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.context !== null && this.context.state !== 'closed') await this.context.close()
    this.node = null
    this.analyser = null
    this.stream = null
    this.context = null
  }
}

function makeContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: PREFERRED_RATE })
  } catch {
    // A device that will not run at 16 kHz is not an error: §6 writes whatever rate it gets.
    return new AudioContext()
  }
}

/**
 * Three distinct outcomes, because they need three different actions from the user: no device
 * at all, a denial they can still reverse in the page, and a denial that now lives in System
 * Settings. Collapsing them sends someone to the wrong screen.
 */
async function classifyMicError(error: unknown): Promise<TurnFailure> {
  const name = error instanceof DOMException ? error.name : ''

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { kind: 'no-microphone' }
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { kind: 'mic-denied', denial: await denialKind() }
  }
  return { kind: 'transcribe-failed', stderr: `microphone: ${String(error)}` }
}

async function denialKind(): Promise<MicDenial> {
  /*
   * macOS first, Chromium second — and that order is the whole point.
   *
   * This asked `navigator.permissions.query` alone, which answers about CHROMIUM's per-origin
   * permission. Whether the operating system will let this process open an input device is a
   * different question, recorded in TCC, and invisible from a page. A user who had switched the
   * microphone off in System Settings therefore got the `retryable` board — *"hold the control
   * again and allow access when macOS asks"* — for a prompt macOS will never show again, because
   * the answer is already recorded. Holding the control again produced the same board. There was
   * no exit.
   */
  try {
    const os = await window.voicedesk.micAccess()
    if (os === 'denied' || os === 'restricted') return 'system-settings'
    // `not-determined` genuinely IS retryable: nobody has answered the prompt yet.
    if (os === 'granted' || os === 'not-determined') return 'retryable'
  } catch {
    // The bridge is unreachable. Fall through rather than deciding on a failed question.
  }

  try {
    const status = await navigator.permissions.query({ name: 'microphone' })
    return status.state === 'denied' ? 'system-settings' : 'retryable'
  } catch {
    // Neither side could answer. That is not evidence of a recorded denial; say the recoverable
    // thing, because it costs the user one retry rather than a wasted trip to System Settings.
    return 'retryable'
  }
}

function concat(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const all = new Float32Array(total)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.length
  }
  return all
}
