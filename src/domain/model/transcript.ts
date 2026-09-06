/** What the transcriber produced from one hold. */
export interface Transcript {
  readonly text: string
  /** How long the user actually held, in milliseconds. Useful to the UI, never to the agent. */
  readonly heldMs: number
}

/**
 * Whisper answers a silent clip with an empty string, or with the punctuation-only fragments it
 * hallucinates from noise. Either way there is nothing to ask an agent about, so the turn ends
 * here rather than spending a model call on it.
 */
export function isEmpty(transcript: Transcript): boolean {
  return transcript.text.replace(/[\s.,!?;:'"-]/g, '').length === 0
}
