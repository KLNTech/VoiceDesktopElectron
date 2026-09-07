/**
 * How long each out-of-process call may take, declared ONCE.
 *
 * Every one of these was previously written twice: the caller built an
 * `AbortSignal.timeout(90_000)` and the adapter separately defaulted `timeoutMs = 90_000`. The
 * two numbers matched, so nothing was visibly wrong — but nothing connected them either, and
 * the failure that arrangement produces is a quiet one.
 *
 * `classify` reports `{ kind: 'timeout', afterMs: this.timeoutMs }` unconditionally, because an
 * abort and a deadline are indistinguishable from the rejection itself (`spawn-failure.ts`). So
 * whenever the caller's signal is the shorter of the two, it fires first, the adapter still
 * quotes its OWN number, and the window tells the user "the agent did not answer within 90
 * seconds" about a call that was stopped at thirty. The user is given a number that never
 * applied, and it is unfalsifiable from the interface.
 *
 * Naming them here makes the two uses the same value by construction rather than by
 * coincidence, which is the only version of this that stays true after someone tunes one of
 * them.
 */
export const DEADLINES = {
  /** Local whisper on a ~2 minute clip. No network, so this bounds a CPU-bound run. */
  transcribe: 60_000,
  /** The agent: the longest wait in the app, and the one the design draws a progress bar for. */
  agent: 90_000,
  /** `say` reading a paragraph aloud. Long, because the bound exists to catch a wedge. */
  speak: 120_000,
} as const

export type Deadline = (typeof DEADLINES)[keyof typeof DEADLINES]
