import type { Outcome } from '../model/turn'
import type { Transcript } from '../model/transcript'
import type { AudioClip } from '../model/audio-clip'

// Re-exported so the adapters and tests that import it from here keep working: the type moved
// because of who is allowed to NAME it, not because this port stopped being about audio.
export type { AudioClip }

/** Speech in, text out. The only implementation that ships runs whisper.cpp on this machine. */
export interface Transcriber {
  transcribe(clip: AudioClip, signal: AbortSignal): Promise<Outcome<Transcript>>
}
