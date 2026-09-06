import { homedir } from 'node:os'
import { join } from 'node:path'

import { failed } from '../domain/model/turn'
import type { AgentRunner } from '../domain/ports/AgentRunner'
import type { SpeechSynthesizer } from '../domain/ports/SpeechSynthesizer'
import type { Transcriber } from '../domain/ports/Transcriber'
import { WhisperCppTranscriber } from '../infrastructure/transcribe/WhisperCppTranscriber'
import { resolveBinary } from '../infrastructure/process/resolveBinary'

export interface Env {
  readonly version: string
  readonly stage: 'dev' | 'build'
  readonly notesDir: string
  readonly agentBin: string | null
  readonly agentModel: string
  readonly whisperBin: string | null
  readonly whisperModel: string
}

/** Every knob in one place, each with a working default (`README.md` → Configuration). */
export function readEnv(isDev: boolean, version: string): Env {
  const env = process.env
  return {
    version,
    stage: isDev ? 'dev' : 'build',
    notesDir: env['VOICEDESK_NOTES_DIR'] ?? join(process.cwd(), 'notes'),
    agentBin: resolveBinary('claude', env['VOICEDESK_AGENT_BIN']),
    // The cheapest current tier, by alias so it can never resolve to an Opus-tier model. This
    // is a demonstration build; an expensive tier must be opted into, never arrived at by
    // accident (`docs/PLAN.md` §5.2).
    agentModel: env['VOICEDESK_AGENT_MODEL'] ?? 'haiku',
    whisperBin: resolveBinary('whisper-cli', env['VOICEDESK_WHISPER_BIN']),
    whisperModel: env['VOICEDESK_WHISPER_MODEL'] ?? join(homedir(), '.whisper/ggml-base.en.bin'),
  }
}

export interface Ports {
  readonly transcriber: Transcriber
  readonly agent: AgentRunner
  readonly voice: SpeechSynthesizer
}

/**
 * The ONE place an adapter is constructed (`docs/PLAN.md` §3). Selection happens here by
 * outcome — env var, availability — so a `new WhisperCppTranscriber()` anywhere else would be
 * a dead seam.
 */
export function buildPorts(env: Env): Ports {
  return {
    transcriber: new WhisperCppTranscriber(env.whisperBin, env.whisperModel),

    // Iteration 1 stops before the agent, by decision, not by omission — see the iteration
    // table in `docs/WORK-BREAKDOWN.md`. These two say so in the app's own failure vocabulary
    // rather than crashing or answering with silence. S7 and S9 replace each with one line.
    agent: {
      run: async () =>
        failed({
          kind: 'setup',
          what: 'agent-cli',
          hint: 'The agent is not wired up in this build yet — iteration 1 ends at speech-to-text. Speaking and transcription work.',
        }),
    },
    voice: {
      speak: async () =>
        failed({
          kind: 'setup',
          what: 'agent-cli',
          hint: 'Spoken replies arrive with the agent, in a later iteration.',
        }),
    },
  }
}
