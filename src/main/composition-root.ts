import { homedir } from 'node:os'
import { join } from 'node:path'

import { AGENT_MODELS, AgentModel, AgentModelSchema, DEFAULT_AGENT_MODEL } from '../../shared/agent-model'
import { failed, succeeded, type Outcome } from '../domain/model/turn'
import type { AgentReply } from '../domain/model/agent-reply'
import type { AgentRunner } from '../domain/ports/AgentRunner'
import type { NotesFolder } from '../domain/ports/NotesFolder'
import type { SpeechSynthesizer } from '../domain/ports/SpeechSynthesizer'
import type { Transcriber } from '../domain/ports/Transcriber'
import { ClaudeCliAgentRunner } from '../infrastructure/agent/ClaudeCliAgentRunner'
import { makeLoginCheck } from '../infrastructure/agent/keychain'
import { MarkdownNotesFolder } from '../infrastructure/notes/MarkdownNotesFolder'
import { MacSaySynthesizer } from '../infrastructure/speak/MacSaySynthesizer'
import { WhisperCppTranscriber } from '../infrastructure/transcribe/WhisperCppTranscriber'
import { resolveBinary } from '../infrastructure/process/resolveBinary'
import { DEADLINES } from './deadlines'

export interface Env {
  readonly version: string
  readonly stage: 'dev' | 'build'
  readonly notesDir: string
  readonly agentBin: string | null
  /** The tier that will be passed to `--model`, or the setup failure that says why not. */
  readonly agentModel: Outcome<AgentModel>
  /** Exactly what the operator configured, valid or not, for the title-bar readout. */
  readonly agentModelRaw: string
  readonly skipLoginCheck: boolean
  readonly whisperBin: string | null
  readonly whisperModel: string
  readonly sayBin: string | null
}

/** Every knob in one place, each with a working default (`README.md` → Configuration). */
export function readEnv(isDev: boolean, version: string): Env {
  const env = process.env
  const rawModel = env['VOICEDESK_AGENT_MODEL'] ?? DEFAULT_AGENT_MODEL
  return {
    version,
    stage: isDev ? 'dev' : 'build',
    notesDir: env['VOICEDESK_NOTES_DIR'] ?? join(process.cwd(), 'notes'),
    agentBin: resolveBinary('claude', env['VOICEDESK_AGENT_BIN']),
    agentModel: readAgentModel(rawModel),
    agentModelRaw: rawModel,
    skipLoginCheck: env['VOICEDESK_SKIP_LOGIN_CHECK'] === '1',
    whisperBin: resolveBinary('whisper-cli', env['VOICEDESK_WHISPER_BIN']),
    whisperModel: env['VOICEDESK_WHISPER_MODEL'] ?? join(homedir(), '.whisper/ggml-base.en.bin'),
    sayBin: resolveBinary('say', env['VOICEDESK_SAY_BIN']),
  }
}

/**
 * `VOICEDESK_AGENT_MODEL` → a tier, or a setup failure naming the three legal values.
 *
 * It does NOT fall back to the default on an unrecognised value, and that is the whole reason
 * this function exists. Silently substituting `haiku` for `hiaku` means an operator who set the
 * variable deliberately gets something else and is never told — and the same silence would one
 * day hide `opus` being ignored, which is the expensive direction. The failure surfaces on the
 * first turn, the way a missing binary does, rather than preventing the window from opening:
 * a typo in one variable should not cost the user an app they can look at.
 */
export function readAgentModel(raw: string): Outcome<AgentModel> {
  const parsed = AgentModelSchema.safeParse(raw)
  return parsed.success
    ? succeeded(parsed.data)
    : failed({
        kind: 'setup',
        what: 'agent-cli',
        hint: `VOICEDESK_AGENT_MODEL is set to "${raw}", which is not a model tier this app will run. Use one of: ${AGENT_MODELS.join(', ')}.`,
      })
}

export interface Ports {
  readonly transcriber: Transcriber
  readonly agent: AgentRunner
  readonly voice: SpeechSynthesizer
  readonly notes: NotesFolder
}

/**
 * The ONE place an adapter is constructed (`docs/PLAN.md` §3). Selection happens here by
 * outcome — env var, availability — so a `new WhisperCppTranscriber()` anywhere else would be
 * a dead seam.
 */
export function buildPorts(env: Env): Ports {
  const notes = new MarkdownNotesFolder(env.notesDir)
  const model = env.agentModel

  return {
    // Each adapter is given the SAME deadline its caller will build a signal from. Passed
    // explicitly rather than left to the constructor default, so the two cannot drift apart
    // and start reporting a number that never applied (`deadlines.ts`).
    transcriber: new WhisperCppTranscriber(env.whisperBin, env.whisperModel, DEADLINES.transcribe),
    notes,
    voice: new MacSaySynthesizer(env.sayBin, DEADLINES.speak),

    // A misconfigured tier is refused here rather than inside the adapter, so the adapter can
    // take an `AgentModel` and never a string that might not be one.
    agent:
      model.k === 'ok'
        ? new ClaudeCliAgentRunner(
            env.agentBin,
            model.value,
            notes,
            env.notesDir,
            makeLoginCheck(env.skipLoginCheck),
            DEADLINES.agent,
          )
        : { run: async () => failed<AgentReply>(model.failure) },
  }
}
