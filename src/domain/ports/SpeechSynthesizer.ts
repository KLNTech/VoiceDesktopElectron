import type { Outcome } from '../model/turn'

/** Reads a reply aloud. The one implementation that ships shells out to the macOS `say`. */
export interface SpeechSynthesizer {
  speak(text: string, signal: AbortSignal): Promise<Outcome<void>>
}
