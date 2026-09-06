import { z } from 'zod'

/**
 * The single declaration of the wire between the three build outputs (`docs/PLAN.md` §7).
 *
 * It is imported by main, preload and renderer, so a change to a payload is a compile error in
 * every process that touches it rather than a runtime surprise in one of them. The preload
 * bridge is also a trust boundary: one XSS in the app's own UI is a compromised client, so
 * every inbound payload is parsed in main before it reaches a use case.
 */
export const CH = {
  transcribe: 'turn:transcribe',
  ask: 'turn:ask',
  speak: 'turn:speak',
  appInfo: 'app:info',
  state: 'turn:state',
} as const

export type Channel = (typeof CH)[keyof typeof CH]

/** Failures cross as data, so the UI can tell a broken machine from a failed turn. */
export const TurnFailureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mic-denied'), denial: z.enum(['retryable', 'system-settings']) }),
  z.object({ kind: z.literal('no-microphone') }),
  z.object({
    kind: z.literal('setup'),
    what: z.enum(['agent-cli', 'agent-auth', 'whisper', 'model']),
    hint: z.string(),
  }),
  z.object({ kind: z.literal('transcribe-failed'), stderr: z.string() }),
  z.object({ kind: z.literal('agent-failed'), stderr: z.string() }),
  z.object({ kind: z.literal('timeout'), afterMs: z.number() }),
  z.object({ kind: z.literal('empty-speech') }),
])

/** Every request→reply message answers with this shape: a value, or a typed failure. */
function outcomeOf<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion('k', [
    z.object({ k: z.literal('ok'), value }),
    z.object({ k: z.literal('failed'), failure: TurnFailureSchema }),
  ])
}

/** Raw mono PCM from one hold. 8 MB is roughly two minutes at 16 kHz — well past any real hold. */
export const TranscribeReq = z.object({
  pcm: z.instanceof(ArrayBuffer).refine((b) => b.byteLength <= 8 * 1024 * 1024, {
    message: 'audio buffer exceeds 8 MB',
  }),
  /**
   * NOT pinned to 16 kHz. §6 asks the device for 16 kHz as an optimisation and writes whatever
   * rate it actually gets, because `whisper-cli` resamples internally. A literal here would
   * reject exactly the 48 kHz device the plan promises to support.
   */
  sampleRate: z.number().int().min(8_000).max(192_000),
  heldMs: z.number().nonnegative(),
})
export const TranscribeRes = outcomeOf(z.object({ text: z.string(), heldMs: z.number() }))

export const AskReq = z.object({
  text: z.string().min(1).max(4_000),
  sessionId: z.string().nullable(),
})
export const AskRes = outcomeOf(
  z.object({
    reply: z.string(),
    notes: z.array(z.string()),
    /** What the CLI reported it ran, not what was configured — the window shows this. */
    model: z.string(),
    sessionId: z.string().nullable(),
    costUsd: z.number().nullable(),
  }),
)

export const SpeakReq = z.object({ text: z.string().min(1).max(4_000) })
export const SpeakRes = outcomeOf(z.null())

export const AppInfoRes = z.object({
  version: z.string(),
  stage: z.enum(['dev', 'build']),
  notesDir: z.string(),
  /** The model the agent CLI is configured to run, shown until a turn reports the real one. */
  agentModel: z.string(),
})

export const TurnStatePush = z.discriminatedUnion('k', [
  z.object({ k: z.literal('idle') }),
  z.object({ k: z.literal('recording'), startedAt: z.number(), level: z.number() }),
  z.object({ k: z.literal('transcribing') }),
  z.object({ k: z.literal('thinking') }),
  z.object({ k: z.literal('speaking') }),
  z.object({ k: z.literal('error'), failure: TurnFailureSchema }),
])

export type TranscribeReq = z.infer<typeof TranscribeReq>
export type TranscribeRes = z.infer<typeof TranscribeRes>
export type AskReq = z.infer<typeof AskReq>
export type AskRes = z.infer<typeof AskRes>
export type SpeakReq = z.infer<typeof SpeakReq>
export type SpeakRes = z.infer<typeof SpeakRes>
export type AppInfoRes = z.infer<typeof AppInfoRes>
export type TurnStatePush = z.infer<typeof TurnStatePush>

/**
 * The whole surface the renderer is given. One named method per message: `ipcRenderer` is never
 * exposed, and nothing here takes a channel name from its caller, so the bridge stays
 * enumerable by reading this type.
 */
export interface VoiceDeskBridge {
  transcribe(request: TranscribeReq): Promise<TranscribeRes>
  ask(request: AskReq): Promise<AskRes>
  speak(request: SpeakReq): Promise<SpeakRes>
  appInfo(): Promise<AppInfoRes>
  /** Returns its own unsubscribe — a remounting component that cannot detach leaks a listener. */
  onTurnState(listener: (state: TurnStatePush) => void): () => void
}
