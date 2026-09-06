import { failed, succeeded, type Outcome, type SpeechOutcome } from '../model/turn'
import { isEmpty, type Transcript } from '../model/transcript'
import type { AgentReply } from '../model/agent-reply'
import type { AudioClip, Transcriber } from '../ports/Transcriber'
import type { AgentRunner } from '../ports/AgentRunner'
import type { SpeechSynthesizer } from '../ports/SpeechSynthesizer'

/** The ports the turn needs. They arrive as arguments, so a test supplies fakes and nothing else. */
export interface VoiceTurnPorts {
  readonly transcriber: Transcriber
  readonly agent: AgentRunner
  readonly voice: SpeechSynthesizer
}

export interface VoiceTurnRequest {
  readonly clip: AudioClip
  readonly sessionId: string | null
  readonly speakReply: boolean
  /**
   * Called with the transcript as soon as it exists, before the agent is asked anything.
   * Showing the user their own words is a separate promise from answering them, and the agent
   * step is the long one — so the transcript must not wait behind it.
   */
  readonly onTranscript?: (transcript: Transcript) => void
}

export interface VoiceTurnResult {
  readonly transcript: Transcript
  readonly reply: AgentReply
  /** What became of the spoken reply — asking for speech does not guarantee getting it. */
  readonly speech: SpeechOutcome
}

export type RunVoiceTurn = (
  request: VoiceTurnRequest,
  signal: AbortSignal,
) => Promise<Outcome<VoiceTurnResult>>

/**
 * audio → transcript → reply, with no platform in sight.
 *
 * The whole flow is expressible here because every edge of it is a port. That is the point of
 * the layer: this function is the product's policy, and it runs in a plain test process.
 */
export function makeRunVoiceTurn(ports: VoiceTurnPorts): RunVoiceTurn {
  return async (request, signal) => {
    const transcription = await ports.transcriber.transcribe(request.clip, signal)
    if (transcription.k === 'failed') return transcription

    const transcript = transcription.value
    // Silence, or the punctuation whisper invents from room noise. Ending here spends no model
    // call and tells the user something they can act on.
    if (isEmpty(transcript)) return failed({ kind: 'empty-speech' })

    request.onTranscript?.(transcript)

    const answer = await ports.agent.run(
      { text: transcript.text, sessionId: request.sessionId },
      signal,
    )
    if (answer.k === 'failed') return answer

    const reply = answer.value
    if (!request.speakReply) return succeeded({ transcript, reply, speech: 'not-requested' })

    // A voice that will not start is not a failed turn: the answer is already on screen, and
    // failing the turn here would throw away a reply the user can read.
    const spoken = await ports.voice.speak(reply.text, signal)
    return succeeded({
      transcript,
      reply,
      speech: spoken.k === 'ok' ? 'spoken' : 'unavailable',
    })
  }
}
