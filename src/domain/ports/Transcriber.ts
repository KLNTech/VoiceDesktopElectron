import type { Outcome } from '../model/turn'
import type { Transcript } from '../model/transcript'

/** Mono audio captured from one hold, at the rate the transcriber expects. */
export interface AudioClip {
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly heldMs: number
}

/** Speech in, text out. The only implementation that ships runs whisper.cpp on this machine. */
export interface Transcriber {
  transcribe(clip: AudioClip, signal: AbortSignal): Promise<Outcome<Transcript>>
}
