import type { NoteFile } from './note-file'

/** What the agent answered, and what it did while answering. */
export interface AgentReply {
  readonly text: string
  /**
   * The notes folder as it stands after the turn, each file carrying what this turn did to it.
   *
   * It was a flat `string[]` of names, which could say *that* a file was involved and never
   * *how*: the design's panel distinguishes a file the agent rewrote from one it only consulted
   * from the majority it never opened, and one list of names collapses all three into "touched"
   * (`docs/design/DESIGN-BRIEF.md` §12, which recorded this as the gap it is).
   */
  readonly notes: readonly NoteFile[]
  /**
   * The model the CLI actually ran, as reported by the CLI itself rather than as configured.
   * The window shows it read-only, so "did this really run on the cheap tier?" is answered by
   * the reply instead of trusted (`docs/PLAN.md` §5.2).
   */
  readonly model: string
  /** The CLI session this turn belongs to, carried so the next turn can resume it (§5.4). */
  readonly sessionId: string | null
  /** What the CLI reported the turn cost, when it reported one. */
  readonly costUsd: number | null
}
