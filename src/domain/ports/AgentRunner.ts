import type { Outcome } from '../model/turn'
import type { AgentReply } from '../model/agent-reply'

export interface AgentRequest {
  readonly text: string
  /** `null` on the first turn of an app session; the previous reply's session id afterwards. */
  readonly sessionId: string | null
}

/** Text in, reply out, with the agent's own file edits as a side effect inside `notes/`. */
export interface AgentRunner {
  run(request: AgentRequest, signal: AbortSignal): Promise<Outcome<AgentReply>>
}
