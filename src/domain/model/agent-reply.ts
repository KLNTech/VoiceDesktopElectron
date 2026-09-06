/** What the agent answered, and what it did while answering. */
export interface AgentReply {
  readonly text: string
  /** Note files the agent touched, relative to `notes/`. The app never writes these itself. */
  readonly notes: readonly string[]
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
